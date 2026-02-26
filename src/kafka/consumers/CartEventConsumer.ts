/**
 * @fileoverview Cart Event Consumer — handles cart abandonment events.
 *
 * Topics: orderchop.carts
 *
 * @module kafka/consumers/CartEventConsumer
 */

import type { EachMessagePayload } from 'kafkajs';
import { createConsumer } from '../../config/kafka.js';
import { KAFKA_TOPICS } from '../topics.js';
import { ContactService } from '../../services/ContactService.js';
import { TriggerService } from '../../services/TriggerService.js';
import { tryProcessEvent } from '../../utils/idempotency.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('CartEventConsumer');

export class CartEventConsumer {
  private consumer: ReturnType<typeof createConsumer> | null = null;
  private readonly contactService: ContactService;
  private readonly triggerService: TriggerService;

  constructor() {
    this.contactService = new ContactService();
    this.triggerService = new TriggerService();
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

      const eventId = `cart:${eventType}:${payload?.cartId ?? message.offset}`;
      const shouldProcess = await tryProcessEvent(eventId, eventType);
      if (!shouldProcess) return;

      log.info({ eventType }, 'Processing cart event');

      if (eventType === 'cart.abandoned') {
        await this.handleCartAbandoned(payload);
      }
    } catch (err) {
      log.error({ err }, 'Error processing cart event');
    }
  }

  private async handleCartAbandoned(payload: Record<string, unknown>): Promise<void> {
    const restaurantId = payload.restaurantId as string;
    const customerId = payload.customerId as string;

    if (!restaurantId || !customerId) {
      log.warn({ restaurantId, customerId }, 'cart.abandoned missing restaurantId or customerId — skipping');
      return;
    }

    const contact = await this.contactService.findByCustomerId(restaurantId, customerId);
    if (!contact) {
      log.warn({ restaurantId, customerId }, 'No contact found for cart.abandoned event — skipping trigger');
      return;
    }

    await this.triggerService.evaluateTriggers(
      restaurantId,
      'abandoned_cart',
      contact._id.toString(),
      payload,
    );
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      log.info('Cart event consumer stopped');
    }
  }
}
