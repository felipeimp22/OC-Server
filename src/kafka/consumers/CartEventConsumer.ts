/**
 * @fileoverview Cart Event Consumer — handles cart abandonment events.
 *
 * Topics: orderchop.carts
 *
 * Instead of immediately triggering abandoned_cart flows, this consumer
 * schedules BullMQ delayed jobs. Each job fires after the configured
 * `delayDays` (from the flow's trigger node config). The
 * AbandonedCartProcessor (US-004) picks up the jobs and evaluates triggers.
 *
 * The deterministic jobId format `abandoned-cart-${orderId}-${flowId}`
 * enables O(1) cancellation in OrderEventConsumer (US-005).
 *
 * @module kafka/consumers/CartEventConsumer
 */

import { Queue } from 'bullmq';
import type { EachMessagePayload } from 'kafkajs';
import { createConsumer } from '../../config/kafka.js';
import { KAFKA_TOPICS } from '../topics.js';
import { ContactService } from '../../services/ContactService.js';
import { FlowRepository } from '../../repositories/FlowRepository.js';
import { tryProcessEvent } from '../../utils/idempotency.js';
import { redis } from '../../config/redis.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('CartEventConsumer');

/** BullMQ queue name for abandoned cart delayed triggers */
export const ABANDONED_CART_QUEUE = 'abandoned-cart-triggers';

/**
 * Singleton BullMQ queue for abandoned cart delayed jobs.
 * Exported so OrderEventConsumer (US-005) can cancel pending jobs.
 * Returns null if Redis is unavailable.
 */
export const abandonedCartQueue: Queue | null = redis
  ? new Queue(ABANDONED_CART_QUEUE, { connection: redis })
  : null;

export class CartEventConsumer {
  private consumer: ReturnType<typeof createConsumer> | null = null;
  private readonly contactService: ContactService;
  private readonly flowRepo: FlowRepository;

  constructor() {
    this.contactService = new ContactService();
    this.flowRepo = new FlowRepository();
  }

  async start(): Promise<void> {
    this.consumer = createConsumer({ groupId: 'crm-cart-consumer' });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [KAFKA_TOPICS.ORDERCHOP_CARTS],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (messagePayload: EachMessagePayload) => {
        await this.handleMessage(messagePayload);
      },
    });

    log.info('Cart event consumer started');
  }

  private async handleMessage({ message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    try {
      const event = JSON.parse(message.value.toString());
      const { eventType, payload } = event;

      // restaurantId is at the top-level of the Kafka message (set by the event bridge
      // from the X-Restaurant-Id header), with payload.restaurantId as fallback
      const restaurantId = (event.restaurantId ?? payload?.restaurantId) as string | undefined;

      // Use the event's own UUID for idempotency; fall back to a synthetic key
      const idempotencyKey: string = event.eventId
        ?? `cart:${eventType}:${payload?.cartId ?? message.offset}`;

      const shouldProcess = await tryProcessEvent(idempotencyKey, eventType);
      if (!shouldProcess) {
        log.debug({ idempotencyKey }, 'Duplicate event — skipping');
        return;
      }

      log.info({ eventType }, 'Processing cart event');

      if (eventType === 'cart.abandoned') {
        await this.handleCartAbandoned(restaurantId, payload);
      }
    } catch (err) {
      log.error({ err }, 'Error processing cart event');
    }
  }

  private async handleCartAbandoned(
    eventRestaurantId: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const restaurantId = (eventRestaurantId ?? payload.restaurantId) as string;
    const customerId = payload.customerId as string;
    const orderId = payload.orderId as string | undefined;

    if (!restaurantId || !customerId) {
      log.warn({ restaurantId, customerId }, 'cart.abandoned missing restaurantId or customerId — skipping');
      return;
    }

    // Upsert contact BEFORE scheduling job so contactId is available in job data
    const contact = await this.contactService.upsertFromEvent(restaurantId, {
      customerId,
      name: payload.customerName as string | undefined,
      email: payload.customerEmail as string | undefined,
    });

    // Find all active flows with abandoned_cart trigger
    const flows = await this.flowRepo.findActiveByTrigger(restaurantId, 'abandoned_cart');

    if (flows.length === 0) {
      log.info({ restaurantId }, 'No active abandoned_cart flows — skipping job scheduling');
      return;
    }

    if (!abandonedCartQueue) {
      log.warn({ restaurantId }, 'Abandoned cart queue not available — Redis disabled');
      return;
    }

    const abandonTime = (payload.createdAt ?? new Date().toISOString()) as string;

    for (const flow of flows) {
      // Find the trigger node to read delayDays config
      const triggerNode = flow.nodes.find(
        (n) => n.type === 'trigger' && n.subType === 'abandoned_cart',
      );
      const delayDays = (triggerNode?.config as Record<string, unknown>)?.delayDays as number | undefined;
      const effectiveDelayDays = Math.max(1, Math.min(90, delayDays ?? 1));
      const delayMs = effectiveDelayDays * 86400000; // days to ms

      const flowId = flow._id.toString();
      const jobId = `abandoned-cart-${orderId ?? customerId}-${flowId}`;

      await abandonedCartQueue.add(
        'abandoned-cart-trigger',
        {
          restaurantId,
          flowId,
          orderId: orderId ?? null,
          customerId,
          contactId: contact._id.toString(),
          customerEmail: (payload.customerEmail as string) ?? contact.email ?? null,
          customerName: (payload.customerName as string) ?? null,
          customerPhone: (payload.customerPhone as string) ?? null,
          cartItems: payload.items ?? null,
          cartTotal: (payload.total as number) ?? null,
          abandonTime,
        },
        {
          delay: delayMs,
          jobId,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );

      log.info(
        { restaurantId, flowId, jobId, delayDays: effectiveDelayDays, delayMs },
        'Scheduled abandoned cart delayed job',
      );
    }
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      log.info('Cart event consumer stopped');
    }
  }
}
