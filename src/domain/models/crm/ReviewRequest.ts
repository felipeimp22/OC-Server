/**
 * @fileoverview CRM Review Request Mongoose model.
 * Collection: `crm_review_requests`
 *
 * Tracks the mandatory post-order review request system.
 * The system-owned "Post-Order Review Request" flow schedules these records
 * after each completed order. Anti-spam rules ensure one request per order
 * with a configurable cooldown period.
 *
 * @module domain/models/crm/ReviewRequest
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Review request lifecycle statuses */
export type ReviewRequestStatus = 'scheduled' | 'sent' | 'clicked' | 'expired';

/** TypeScript interface for the CRM ReviewRequest document */
export interface IReviewRequestDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  /** Contact who received the review request */
  contactId: Types.ObjectId;
  /** The order this review request is for (ref → existing Order collection) */
  orderId: Types.ObjectId;
  /** Channel used to send the request */
  channel: string;
  /** Current status */
  status: ReviewRequestStatus;
  /** When the review request is/was scheduled to be sent */
  scheduledAt: Date;
  /** When the request was actually sent */
  sentAt: Date | null;
  /** When the recipient clicked the review link */
  clickedAt: Date | null;
  /** The review URL (e.g., Google Maps review link) */
  reviewUrl: string;
}

const ReviewRequestSchema = new Schema<IReviewRequestDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    contactId: { type: Schema.Types.ObjectId, required: true },
    orderId: { type: Schema.Types.ObjectId, required: true },
    channel: { type: String, enum: ['email', 'sms'], required: true },
    status: {
      type: String,
      enum: ['scheduled', 'sent', 'clicked', 'expired'],
      default: 'scheduled',
    },
    scheduledAt: { type: Date, required: true },
    sentAt: { type: Date, default: null },
    clickedAt: { type: Date, default: null },
    reviewUrl: { type: String, required: true },
  },
  {
    collection: 'crm_review_requests',
    timestamps: true,
  },
);

/** One review request per order per contact per restaurant */
ReviewRequestSchema.index(
  { restaurantId: 1, contactId: 1, orderId: 1 },
  { unique: true },
);
/** For scheduler: find pending review requests */
ReviewRequestSchema.index({ restaurantId: 1, status: 1 });
/** For scheduler: find review requests ready to send */
ReviewRequestSchema.index({ status: 1, scheduledAt: 1 });

export const ReviewRequest = mongoose.model<IReviewRequestDocument>(
  'CrmReviewRequest',
  ReviewRequestSchema,
);
