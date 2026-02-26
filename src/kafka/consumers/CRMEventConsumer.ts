/**
 * @fileoverview CRM Internal Event Consumer — handles internal CRM events.
 *
 * Topics: crm.flow.execute, crm.contacts
 *
 * These are produced by the CRM engine itself to chain flow steps and
 * propagate contact changes that may trigger other flows.
 *
 * @module kafka/consumers/CRMEventConsumer
 */

import type { EachMessagePayload } from 'kafkajs';
import { createConsumer } from '../../config/kafka.js';
import { KAFKA_TOPICS } from '../topics.js';
import { FlowEngineService } from '../../services/FlowEngineService.js';
import { TriggerService } from '../../services/TriggerService.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('CRMEventConsumer');

export class CRMEventConsumer {
  private consumer: ReturnType<typeof createConsumer> | null = null;
  private readonly flowEngine: FlowEngineService;
  private readonly triggerService: TriggerService;

  constructor() {
    this.flowEngine = new FlowEngineService();
    this.triggerService = new TriggerService();
  }

  async start(): Promise<void> {
    this.consumer = createConsumer({ groupId: 'crm-internal-consumer' });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [KAFKA_TOPICS.CRM_FLOW_EXECUTE, KAFKA_TOPICS.CRM_CONTACTS],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (messagePayload: EachMessagePayload) => {
        await this.handleMessage(messagePayload);
      },
    });

    log.info('CRM internal event consumer started');
  }

  private async handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    try {
      const event = JSON.parse(message.value.toString());

      if (topic === KAFKA_TOPICS.CRM_FLOW_EXECUTE) {
        await this.handleFlowExecute(event);
      } else if (topic === KAFKA_TOPICS.CRM_CONTACTS) {
        await this.handleContactEvent(event);
      }
    } catch (err) {
      log.error({ err, topic }, 'Error processing internal CRM event');
    }
  }

  /**
   * Handle flow.step.ready and flow.timer.expired events.
   */
  private async handleFlowExecute(event: Record<string, unknown>): Promise<void> {
    const eventType = event.eventType as string;
    const executionId = event.executionId as string;

    if (!executionId) {
      log.warn({ event }, 'Missing executionId in flow execute event');
      return;
    }

    log.info({ eventType, executionId }, 'Processing flow execution event');

    switch (eventType) {
      case 'flow.step.ready':
      case 'flow.timer.expired':
        await this.flowEngine.processCurrentNode(executionId);
        break;

      default:
        log.debug({ eventType }, 'Unhandled flow execute event type');
    }
  }

  /**
   * Handle internal contact events (tag applied, field changed, lifecycle changed).
   * These can trigger other flows.
   */
  private async handleContactEvent(event: Record<string, unknown>): Promise<void> {
    const eventType = event.eventType as string;
    const payload = event.payload as Record<string, unknown>;

    if (!payload) return;

    const restaurantId = payload.restaurantId as string;
    const contactId = payload.contactId as string;

    if (!restaurantId || !contactId) return;

    log.debug({ eventType, contactId }, 'Processing internal contact event');

    // Map internal event types to trigger subtypes
    let triggerType: string | null = null;
    switch (eventType) {
      case 'contact.tag_applied':
        triggerType = 'tag_applied';
        break;
      case 'contact.field_changed':
        triggerType = 'field_changed';
        break;
      case 'contact.tag_removed':
        triggerType = 'tag_removed';
        break;
      case 'contact.lifecycle_changed':
        triggerType = 'lifecycle_changed';
        break;
      default:
        return; // Not a triggerable event
    }

    if (triggerType) {
      await this.triggerService.evaluateTriggers(restaurantId, triggerType, contactId, payload);
    }
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      log.info('CRM internal event consumer stopped');
    }
  }
}
