/**
 * @fileoverview PrintJob Mongoose model.
 * Collection: `print_jobs`
 *
 * Tracks individual print job lifecycle from creation through delivery
 * to the Star Micronics printer via email. Supports auto, manual, retry,
 * and kitchen trigger types.
 *
 * @module domain/models/PrintJob
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Print job processing status */
export type PrintJobStatus = 'pending' | 'queued' | 'sending' | 'sent' | 'failed' | 'dead_letter';

/** What initiated the print job */
export type PrintTrigger = 'auto' | 'manual' | 'retry' | 'kitchen';

/** TypeScript interface for the PrintJob document */
export interface IPrintJobDocument extends Document {
  _id: Types.ObjectId;
  /** Tenant isolation — every query must filter by this */
  restaurantId: Types.ObjectId;
  /** Reference to the Printer that will execute this job */
  printerId: Types.ObjectId;
  /** Reference to the Order being printed */
  orderId: Types.ObjectId;
  /** Current processing status */
  status: PrintJobStatus;
  /** What triggered this print job */
  trigger: PrintTrigger;
  /** Number of delivery attempts */
  attempts: number;
  /** Maximum delivery attempts before dead-lettering */
  maxAttempts: number;
  /** Last error message (on failure) */
  lastError?: string;
  /** Pre-rendered HTML receipt content */
  receiptHtml: string;
  /** Restaurant timezone for timestamp formatting */
  timezone: string;
  /** When the job is scheduled to be processed */
  scheduledAt: Date;
  /** When the email was successfully sent */
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PrintJobSchema = new Schema<IPrintJobDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    printerId: { type: Schema.Types.ObjectId, ref: 'Printer', required: true },
    orderId: { type: Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      enum: ['pending', 'queued', 'sending', 'sent', 'failed', 'dead_letter'],
      default: 'pending',
    },
    trigger: {
      type: String,
      enum: ['auto', 'manual', 'retry', 'kitchen'],
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lastError: { type: String },
    receiptHtml: { type: String },
    timezone: { type: String },
    scheduledAt: { type: Date },
    sentAt: { type: Date },
  },
  {
    collection: 'print_jobs',
    timestamps: true,
  },
);

/** Filter by restaurant + status (e.g., find all pending jobs) */
PrintJobSchema.index({ restaurantId: 1, status: 1 });
/** Filter by printer + status (e.g., find queued jobs for a specific printer) */
PrintJobSchema.index({ printerId: 1, status: 1 });
/** Find print jobs for a specific order */
PrintJobSchema.index({ orderId: 1 });

export const PrintJob = mongoose.model<IPrintJobDocument>('PrintJob', PrintJobSchema);
