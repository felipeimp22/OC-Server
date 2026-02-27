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
