/**
 * @fileoverview CRM Internal Event Consumer — handles internal CRM flow execution events.
 *
 * Topics: crm.flow.execute
 *
 * Produced by the CRM engine itself to chain flow steps.
 *
 * @module kafka/consumers/CRMEventConsumer
 */

import type { EachMessagePayload } from 'kafkajs';
import { createConsumer } from '../../config/kafka.js';
import { KAFKA_TOPICS } from '../topics.js';
import { FlowEngineService } from '../../services/FlowEngineService.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('CRMEventConsumer');

export class CRMEventConsumer {
  private consumer: ReturnType<typeof createConsumer> | null = null;
  private readonly flowEngine: FlowEngineService;

  constructor() {
    this.flowEngine = new FlowEngineService();
  }

  async start(): Promise<void> {
    this.consumer = createConsumer({ groupId: 'crm-internal-consumer' });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [KAFKA_TOPICS.CRM_FLOW_EXECUTE],
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
      }
    } catch (err) {
      log.error({ err, topic }, 'Error processing internal CRM event');
    }
  }

  /**
   * Handle flow.step.ready events.
   * For fan-out: each event carries a nextNodeId specifying which node to process.
   * Multiple concurrent events for the same execution process different nodes in parallel.
   */
  private async handleFlowExecute(event: Record<string, unknown>): Promise<void> {
    const eventType = event.eventType as string;
    const executionId = event.executionId as string;
    const nextNodeId = event.nextNodeId as string | undefined;

    if (!executionId) {
      log.warn({ event }, 'Missing executionId in flow execute event');
      return;
    }

    log.info({ eventType, executionId, nextNodeId }, 'Processing flow execution event');

    switch (eventType) {
      case 'flow.step.ready':
        // Pass nextNodeId so the engine processes the specific node (fan-out support)
        await this.flowEngine.processCurrentNode(executionId, nextNodeId);
        break;

      default:
        log.debug({ eventType }, 'Unhandled flow execute event type');
    }
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      log.info('CRM internal event consumer stopped');
    }
  }
}
