/**
 * @fileoverview Queue Message Mongoose model.
 * Collection: `queue_messages`
 *
 * Provides a MongoDB-backed message queue for environments without Kafka
 * (local development, testing). Messages are claimed atomically via
 * findOneAndUpdate to prevent duplicate consumption.
 *
 * @module domain/models/QueueMessage
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Possible states of a queued message */
export type QueueMessageStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** TypeScript interface for the QueueMessage document */
export interface IQueueMessageDocument extends Document {
  _id: Types.ObjectId;
  /** Topic/channel the message belongs to */
  topic: string;
  /** Partition key (typically restaurantId) */
  key: string;
  /** Serializable message payload */
  value: Record<string, unknown>;
  /** Optional metadata headers */
  headers: Map<string, string>;
  /** Processing status */
  status: QueueMessageStatus;
  /** Number of processing attempts */
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const QueueMessageSchema = new Schema<IQueueMessageDocument>(
  {
    topic: { type: String, required: true, index: true },
    key: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    headers: { type: Map, of: String, default: new Map() },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
  },
  {
    collection: 'queue_messages',
    timestamps: true,
  },
);

/** Efficient polling: find pending messages for a topic, ordered by creation time */
QueueMessageSchema.index({ topic: 1, status: 1, createdAt: 1 });

export const QueueMessage = mongoose.model<IQueueMessageDocument>(
  'QueueMessage',
  QueueMessageSchema,
);
