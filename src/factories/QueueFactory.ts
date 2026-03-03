/**
 * @fileoverview Queue adapter factory.
 *
 * Returns the correct QueuePort implementation based on the
 * configured adapter type. Adapters are implemented in US-003 (Kafka)
 * and US-004 (Mongo).
 *
 * @module factories/QueueFactory
 */

import type { QueuePort } from '../ports/QueuePort.js';

/** Supported queue adapter types */
export type QueueAdapter = 'kafka' | 'mongo';

/**
 * Create or return a QueuePort for the given adapter.
 *
 * @param adapter - Which queue backend to use
 * @returns The QueuePort implementation
 * @throws If the adapter is not yet implemented
 */
export function getQueueAdapter(adapter: QueueAdapter): QueuePort {
  switch (adapter) {
    case 'kafka':
      // Implemented in US-003 (KafkaQueueAdapter)
      throw new Error('Kafka adapter not implemented — see US-003');
    case 'mongo':
      // Implemented in US-004 (MongoQueueAdapter)
      throw new Error('Mongo adapter not implemented — see US-004');
    default:
      throw new Error(`Unknown queue adapter: ${adapter}`);
  }
}
