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
 * Attempt to mark an event as processed, optionally executing a callback on first occurrence.
 *
 * Inserts the eventId via markProcessed (throws E11000 on duplicate).
 * Catches E11000 silently and returns false.
 * On first occurrence: calls fn() if provided, then returns true.
 *
 * @param eventId - UUID from the Kafka event
 * @param eventType - Event type for logging
 * @param fn - Optional async callback to execute only on first occurrence
 * @returns true if this is the first processing (fn was called if provided), false if duplicate
 *
 * @example
 * ```ts
 * const processed = await tryProcessEvent(eventId, eventType, async () => {
 *   await handleEvent(payload);
 * });
 * if (!processed) {
 *   log.debug({ eventId }, 'Skipping duplicate event');
 * }
 * ```
 */
export async function tryProcessEvent(
  eventId: string,
  eventType: string,
  fn?: () => Promise<void>,
): Promise<boolean> {
  try {
    await repo.markProcessed(eventId, eventType);
  } catch (err: unknown) {
    // E11000 duplicate key — event already processed, skip silently
    if (err instanceof Error && 'code' in err && (err as { code: number }).code === 11000) {
      log.debug({ eventId, eventType }, 'Event already processed — skipping');
      return false;
    }
    throw err;
  }

  if (fn) {
    await fn();
  }

  return true;
}
