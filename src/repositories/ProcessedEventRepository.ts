/**
 * @fileoverview CRM Processed Event repository.
 *
 * Manages idempotency: checks if an event has already been processed,
 * records processed events.
 *
 * @module repositories/ProcessedEventRepository
 */

import { ProcessedEvent } from '../domain/models/crm/ProcessedEvent.js';

export class ProcessedEventRepository {
  /**
   * Mark an event as processed by inserting a document.
   * Throws a DuplicateKeyError (E11000) if the event was already processed.
   *
   * @param eventId - UUID of the Kafka event
   * @param eventType - Event type for debugging
   * @throws MongoDB E11000 DuplicateKeyError on duplicate eventId
   */
  async markProcessed(eventId: string, eventType: string): Promise<void> {
    await ProcessedEvent.create({ eventId, eventType, createdAt: new Date() });
  }
}
