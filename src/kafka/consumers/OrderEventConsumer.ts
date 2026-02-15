/**
 * @fileoverview Order Event Consumer — handles order and payment events from OrderChop.
 *
 * Topics: orderchop.orders, orderchop.payments
 *
 * @module kafka/consumers/OrderEventConsumer
 */

import type { EachMessagePayload } from 'kafkajs';
import { createConsumer } from '../../config/kafka.js';
import { KAFKA_TOPICS } from '../topics.js';
import { ContactService } from '../../services/ContactService.js';
import { TriggerService } from '../../services/TriggerService.js';
import { tryProcessEvent } from '../../utils/idempotency.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('OrderEventConsumer');

export class OrderEventConsumer {
  private consumer: ReturnType<typeof createConsumer> | null = null;
  private readonly contactService: ContactService;
  private readonly triggerService: TriggerService;

  constructor() {
    this.contactService = new ContactService();
    this.triggerService = new TriggerService();
  }

  async start(): Promise<void> {
    this.consumer = createConsumer({ groupId: 'crm-order-consumer' });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [KAFKA_TOPICS.ORDERCHOP_ORDERS, KAFKA_TOPICS.ORDERCHOP_PAYMENTS],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (messagePayload: EachMessagePayload) => {
        await this.handleMessage(messagePayload);
      },
    });

    log.info('Order event consumer started');
  }

  private async handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    try {
      const event = JSON.parse(message.value.toString());
      const { eventType, payload } = event;

      // Idempotency check
      const eventId = `${topic}:${eventType}:${payload?.orderId ?? message.offset}`;
      const shouldProcess = await tryProcessEvent(eventId, eventType);
      if (!shouldProcess) {
        log.debug({ eventId }, 'Duplicate event — skipping');
        return;
      }

      log.info({ eventType, orderId: payload?.orderId }, 'Processing order event');

      switch (eventType) {
        case 'order.created':
        case 'order.confirmed':
          await this.handleOrderEvent(eventType, payload);
          break;

        case 'order.completed':
          await this.handleOrderCompleted(payload);
          break;

        case 'order.cancelled':
          await this.handleOrderEvent('order_cancelled', payload);
          break;

        case 'order.status_changed':
          await this.handleOrderEvent('order_status_changed', payload);
          break;

        case 'payment.succeeded':
          await this.handleOrderEvent('payment_succeeded', payload);
          break;

        case 'payment.failed':
        case 'payment.refunded':
          await this.handleOrderEvent(eventType.replace('.', '_'), payload);
          break;

        default:
          log.debug({ eventType }, 'Unhandled order event type');
      }
    } catch (err) {
      log.error({ err }, 'Error processing order event');
    }
  }

  /**
   * Handle order.completed — update contact stats + trigger flows.
   */
  private async handleOrderCompleted(payload: Record<string, unknown>): Promise<void> {
    const restaurantId = payload.restaurantId as string;
    const customerId = payload.customerId as string;

    if (!restaurantId || !customerId) return;

    // Get or create contact
    const contact = await this.contactService.getByCustomerId(restaurantId, customerId);
    if (!contact) {
      log.warn({ restaurantId, customerId }, 'Contact not found for completed order');
      return;
    }

    // Update order stats
    const orderTotal = (payload.total as number) ?? 0;
    await this.contactService.recordOrder(restaurantId, contact._id.toString(), orderTotal);

    // Evaluate triggers
    await this.triggerService.evaluateTriggers(restaurantId, 'order_completed', contact._id.toString(), {
      orderId: payload.orderId as string,
      orderTotal,
      orderType: payload.orderType as string,
      customerId,
    });
  }

  /**
   * Handle generic order events — just evaluate triggers.
   */
  private async handleOrderEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    const restaurantId = payload.restaurantId as string;
    const customerId = payload.customerId as string;
    if (!restaurantId || !customerId) return;

    const contact = await this.contactService.getByCustomerId(restaurantId, customerId);
    if (!contact) return;

    await this.triggerService.evaluateTriggers(restaurantId, eventType, contact._id.toString(), payload);
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      log.info('Order event consumer stopped');
    }
  }
}
