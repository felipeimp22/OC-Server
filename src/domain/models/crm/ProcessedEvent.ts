/**
 * @fileoverview CRM Processed Event Mongoose model.
 * Collection: `crm_processed_events`
 *
 * Ensures idempotent event processing. Before processing any Kafka event,
 * the CRM engine checks if the `eventId` has already been processed.
 * If so, the event is skipped.
 *
 * A TTL index automatically removes old records after 90 days.
 *
 * @module domain/models/crm/ProcessedEvent
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the CRM ProcessedEvent document */
export interface IProcessedEventDocument extends Document {
  _id: Types.ObjectId;
  /** UUID event ID from the Kafka message */
  eventId: string;
  /** Event type for debugging (e.g., "order.completed") */
  eventType: string;
  /** When the event was created/processed — used for TTL expiry */
  createdAt: Date;
}

const ProcessedEventSchema = new Schema<IProcessedEventDocument>(
  {
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  {
    collection: 'crm_processed_events',
    timestamps: false,
  },
);

/** Unique event ID for idempotency checks */
ProcessedEventSchema.index({ eventId: 1 }, { unique: true });
/** Auto-expire processed events after 90 days to keep the collection manageable */
ProcessedEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const ProcessedEvent = mongoose.model<IProcessedEventDocument>(
  'CrmProcessedEvent',
  ProcessedEventSchema,
);
