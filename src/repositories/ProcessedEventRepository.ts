/**
 * @fileoverview CRM Processed Event repository.
 *
 * Manages idempotency: checks if an event has already been processed,
 * records processed events.
 *
 * @module repositories/ProcessedEventRepository
 */

import { ProcessedEvent } from '../domain/models/crm/ProcessedEvent.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('ProcessedEventRepository');

export class ProcessedEventRepository {
  /**
   * Check if an event has already been processed.
   *
   * @param eventId - UUID of the Kafka event
   * @returns true if the event was already processed
   */
  async isProcessed(eventId: string): Promise<boolean> {
    const count = await ProcessedEvent.countDocuments({ eventId }).exec();
    return count > 0;
  }

  /**
   * Mark an event as processed.
   * Uses upsert to handle race conditions (two consumers processing same event).
   *
   * @param eventId - UUID of the Kafka event
   * @param eventType - Event type for debugging
   * @returns true if this call marked it as processed (false if already existed)
   */
  async markProcessed(eventId: string, eventType: string): Promise<boolean> {
    try {
      await ProcessedEvent.updateOne(
        { eventId },
        { $setOnInsert: { eventId, eventType, processedAt: new Date() } },
        { upsert: true },
      ).exec();
      return true;
    } catch (err: unknown) {
      // Duplicate key error means it was already processed (race condition)
      if (err instanceof Error && 'code' in err && (err as { code: number }).code === 11000) {
        log.debug({ eventId }, 'Event already processed (duplicate key)');
        return false;
      }
      throw err;
    }
  }
}
