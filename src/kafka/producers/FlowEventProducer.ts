/**
 * @fileoverview Flow Event Producer — publishes flow execution events.
 *
 * @module kafka/producers/FlowEventProducer
 */

import { getProducer } from '../../config/kafka.js';
import { KAFKA_TOPICS } from '../topics.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('FlowEventProducer');

/**
 * Produce a flow.step.ready event to advance a flow execution.
 */
export async function produceFlowStepReady(
  executionId: string,
  nextNodeId: string,
): Promise<void> {
  try {
    const producer = getProducer();
    await producer.send({
      topic: KAFKA_TOPICS.CRM_FLOW_EXECUTE,
      messages: [
        {
          key: executionId,
          value: JSON.stringify({
            eventType: 'flow.step.ready',
            executionId,
            nextNodeId,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    });
    log.debug({ executionId, nextNodeId }, 'flow.step.ready produced');
  } catch (err) {
    log.error({ err, executionId }, 'Failed to produce flow.step.ready');
  }
}

/**
 * Produce a flow.timer.expired event when a BullMQ timer fires.
 */
export async function produceFlowTimerExpired(
  executionId: string,
  nodeId: string,
): Promise<void> {
  try {
    const producer = getProducer();
    await producer.send({
      topic: KAFKA_TOPICS.CRM_FLOW_EXECUTE,
      messages: [
        {
          key: executionId,
          value: JSON.stringify({
            eventType: 'flow.timer.expired',
            executionId,
            nodeId,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    });
    log.debug({ executionId, nodeId }, 'flow.timer.expired produced');
  } catch (err) {
    log.error({ err, executionId }, 'Failed to produce flow.timer.expired');
  }
}
