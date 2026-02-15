/**
 * @fileoverview CRM Event Producer — publishes internal CRM events to Kafka.
 *
 * @module kafka/producers/CRMEventProducer
 */

import { getProducer } from '../../config/kafka.js';
import { KAFKA_TOPICS } from '../topics.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('CRMEventProducer');

/**
 * Produce a CRM contact event (tag changed, field changed, lifecycle changed).
 */
export async function produceContactEvent(
  eventType: string,
  payload: {
    restaurantId: string;
    contactId: string;
    [key: string]: unknown;
  },
): Promise<void> {
  try {
    const producer = getProducer();
    await producer.send({
      topic: KAFKA_TOPICS.CRM_CONTACTS,
      messages: [
        {
          key: `${payload.restaurantId}:${payload.contactId}`,
          value: JSON.stringify({
            eventType,
            payload,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    });
    log.debug({ eventType, contactId: payload.contactId }, 'Contact event produced');
  } catch (err) {
    log.error({ err, eventType }, 'Failed to produce contact event');
  }
}

/**
 * Produce a CRM notification event (outgoing to OrderChop app).
 */
export async function produceNotification(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const producer = getProducer();
    await producer.send({
      topic: KAFKA_TOPICS.CRM_NOTIFICATIONS,
      messages: [
        {
          key: (payload.restaurantId as string) ?? 'system',
          value: JSON.stringify({
            eventType,
            payload,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    });
    log.debug({ eventType }, 'Notification event produced');
  } catch (err) {
    log.error({ err, eventType }, 'Failed to produce notification');
  }
}
