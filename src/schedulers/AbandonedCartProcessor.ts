/**
 * @fileoverview Abandoned Cart Processor — BullMQ worker for abandoned cart delayed triggers.
 *
 * When a delayed job fires (after the configured delayDays), this processor:
 * 1. Checks if the order is still pending (not completed/paid)
 * 2. If still pending: evaluates the abandoned_cart trigger → enrolls in flow
 * 3. If completed: skips (customer already ordered)
 *
 * @module schedulers/AbandonedCartProcessor
 */

import { Worker, type Job } from 'bullmq';
import { ABANDONED_CART_QUEUE } from '../kafka/consumers/CartEventConsumer.js';
import { TriggerService } from '../services/TriggerService.js';
import { Order } from '../domain/models/external/Order.js';
import { redis } from '../config/redis.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('AbandonedCartProcessor');

/** Order statuses that indicate the order has been completed — skip the abandoned cart flow */
const COMPLETED_STATUSES = [
  'paid',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'completed',
];

interface AbandonedCartJobData {
  restaurantId: string;
  flowId: string;
  orderId: string | null;
  customerId: string;
  contactId: string;
  customerEmail: string | null;
  customerName: string | null;
  customerPhone: string | null;
  cartItems: unknown;
  cartTotal: number | null;
  abandonTime: string;
}

export class AbandonedCartProcessor {
  private worker: Worker | null = null;
  private readonly triggerService: TriggerService;

  constructor() {
    this.triggerService = new TriggerService();
  }

  start(): void {
    if (!redis) {
      log.warn('Redis not available — abandoned cart processor disabled');
      return;
    }

    this.worker = new Worker(
      ABANDONED_CART_QUEUE,
      async (job: Job) => {
        await this.processAbandonedCartJob(job);
      },
      {
        connection: redis,
        concurrency: 10,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    );

    this.worker.on('completed', (job) => {
      log.debug({ jobId: job.id }, 'Abandoned cart job completed');
    });

    this.worker.on('failed', (job, err) => {
      log.error({ jobId: job?.id, err }, 'Abandoned cart job failed');
    });

    log.info('Abandoned cart processor started');
  }

  private async processAbandonedCartJob(job: Job): Promise<void> {
    const data = job.data as AbandonedCartJobData;
    const {
      restaurantId,
      flowId,
      orderId,
      customerId,
      contactId,
      customerEmail,
      customerName,
      customerPhone,
      cartItems,
      cartTotal,
      abandonTime,
    } = data;

    log.info(
      { restaurantId, flowId, orderId, customerId, contactId, jobId: job.id },
      'Abandoned cart job received',
    );

    // If we have an orderId, check whether the order has already been completed
    if (orderId) {
      const order = await Order.findById(orderId).lean().exec();

      if (!order) {
        log.warn(
          { orderId, flowId },
          'Order not found in database — skipping abandoned cart flow',
        );
        return;
      }

      if (COMPLETED_STATUSES.includes(order.status)) {
        log.info(
          { orderId, flowId, orderStatus: order.status },
          'Order already completed — skipping abandoned cart flow',
        );
        return;
      }

      log.info(
        { orderId, flowId, orderStatus: order.status },
        'Order still pending — triggering abandoned cart flow',
      );
    } else {
      log.info(
        { customerId, flowId },
        'No orderId on abandoned cart job — triggering flow',
      );
    }

    // Build trigger context from job data
    const triggerContext = {
      orderId: orderId ?? undefined,
      customerId,
      customerEmail,
      customerName,
      customerPhone,
      items: cartItems,
      orderTotal: cartTotal,
      abandonTime,
    };

    await this.triggerService.evaluateTriggers(
      restaurantId,
      'abandoned_cart',
      contactId,
      triggerContext as any,
    );

    log.info(
      { restaurantId, flowId, orderId, contactId },
      'Abandoned cart trigger evaluation complete',
    );
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      log.info('Abandoned cart processor stopped');
    }
  }
}
