/**
 * @fileoverview Customer Event Consumer — handles customer events from OrderChop.
 *
 * Topics: orderchop.customers
 *
 * @module kafka/consumers/CustomerEventConsumer
 */

import type { EachMessagePayload } from 'kafkajs';
import { createConsumer } from '../../config/kafka.js';
import { KAFKA_TOPICS } from '../topics.js';
import { ContactService } from '../../services/ContactService.js';
import { TriggerService } from '../../services/TriggerService.js';
import { tryProcessEvent } from '../../utils/idempotency.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('CustomerEventConsumer');

export class CustomerEventConsumer {
  private consumer: ReturnType<typeof createConsumer> | null = null;
  private readonly contactService: ContactService;
  private readonly triggerService: TriggerService;

  constructor() {
    this.contactService = new ContactService();
    this.triggerService = new TriggerService();
  }

  async start(): Promise<void> {
    this.consumer = createConsumer({ groupId: 'crm-customer-consumer' });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [KAFKA_TOPICS.ORDERCHOP_CUSTOMERS],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (messagePayload: EachMessagePayload) => {
        await this.handleMessage(messagePayload);
      },
    });

    log.info('Customer event consumer started');
  }

  private async handleMessage({ message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    try {
      const event = JSON.parse(message.value.toString());
      const { eventType, payload } = event;

      // Idempotency
      const eventId = `customer:${eventType}:${payload?.customerId ?? message.offset}`;
      const shouldProcess = await tryProcessEvent(eventId, eventType);
      if (!shouldProcess) return;

      log.info({ eventType, customerId: payload?.customerId }, 'Processing customer event');

      switch (eventType) {
        case 'customer.created':
          await this.handleCustomerCreated(payload);
          break;

        case 'customer.updated':
          await this.handleCustomerUpdated(payload);
          break;

        default:
          log.debug({ eventType }, 'Unhandled customer event type');
      }
    } catch (err) {
      log.error({ err }, 'Error processing customer event');
    }
  }

  private async handleCustomerCreated(payload: Record<string, unknown>): Promise<void> {
    const restaurantId = payload.restaurantId as string;
    const customerId = payload.customerId as string;

    if (!restaurantId || !customerId) {
      log.warn({ restaurantId, customerId }, 'customer.created missing restaurantId or customerId — skipping');
      return;
    }

    const contact = await this.contactService.upsertFromCustomer(restaurantId, {
      customerId,
      name: (payload.name as string) ?? '',
      email: (payload.email as string) ?? '',
      phone: payload.phone as { countryCode: string; number: string } | null,
    });

    await this.triggerService.evaluateTriggers(
      restaurantId,
      'customer_created',
      contact._id.toString(),
      payload,
    );
  }

  private async handleCustomerUpdated(payload: Record<string, unknown>): Promise<void> {
    const restaurantId = payload.restaurantId as string;
    const customerId = payload.customerId as string;

    if (!restaurantId || !customerId) {
      log.warn({ restaurantId, customerId }, 'customer.updated missing restaurantId or customerId — skipping');
      return;
    }

    await this.contactService.upsertFromCustomer(restaurantId, {
      customerId,
      name: (payload.name as string) ?? '',
      email: (payload.email as string) ?? '',
      phone: payload.phone as { countryCode: string; number: string } | null,
    });
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      log.info('Customer event consumer stopped');
    }
  }
}
