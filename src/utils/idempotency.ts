/**
 * @fileoverview Idempotent event processing guard.
 *
 * Wraps the ProcessedEventRepository to provide a simple API for
 * ensuring each Kafka event is processed exactly once.
 *
 * @module utils/idempotency
 */

import { ProcessedEventRepository } from '../repositories/ProcessedEventRepository.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('idempotency');
const repo = new ProcessedEventRepository();

/**
 * Check and mark an event as processed in a single atomic operation.
 *
 * @param eventId - UUID from the Kafka event
 * @param eventType - Event type for logging
 * @returns true if this is the first processing (proceed), false if already processed (skip)
 *
 * @example
 * ```ts
 * const shouldProcess = await tryProcessEvent(event.eventId, event.eventType);
 * if (!shouldProcess) {
 *   log.debug({ eventId }, 'Skipping duplicate event');
 *   return;
 * }
 * // ... process the event
 * ```
 */
export async function tryProcessEvent(eventId: string, eventType: string): Promise<boolean> {
  const alreadyProcessed = await repo.isProcessed(eventId);
  if (alreadyProcessed) {
    log.debug({ eventId, eventType }, 'Event already processed — skipping');
    return false;
  }

  const marked = await repo.markProcessed(eventId, eventType);
  if (!marked) {
    log.debug({ eventId, eventType }, 'Event was processed by another consumer — skipping');
    return false;
  }

  return true;
}
