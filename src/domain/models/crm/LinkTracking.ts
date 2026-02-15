/**
 * @fileoverview CRM Link Tracking Mongoose model.
 * Collection: `crm_link_tracking`
 *
 * Tracks clicks on links embedded in emails/SMS. Each link in a sent message
 * gets a unique tracking URL. When the recipient clicks it, they're redirected
 * to the original URL and the click is recorded.
 *
 * Used for:
 * - Click-through rate analytics
 * - Triggering "link.clicked" CRM events (which can start flows)
 * - Review request click tracking
 *
 * @module domain/models/crm/LinkTracking
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the CRM LinkTracking document */
export interface ILinkTrackingDocument extends Document {
  _id: Types.ObjectId;
  /** Reference to the communication log that contained this link */
  communicationLogId: Types.ObjectId;
  /** The original destination URL */
  originalUrl: string;
  /** The generated tracking URL (short, unique) */
  trackingUrl: string;
  /** Total number of clicks on this link */
  clickCount: number;
  /** Timestamp of the most recent click */
  lastClickedAt: Date | null;
  /** Contact who received this link */
  contactId: Types.ObjectId;
}

const LinkTrackingSchema = new Schema<ILinkTrackingDocument>(
  {
    communicationLogId: { type: Schema.Types.ObjectId, required: true },
    originalUrl: { type: String, required: true },
    trackingUrl: { type: String, required: true },
    clickCount: { type: Number, default: 0 },
    lastClickedAt: { type: Date, default: null },
    contactId: { type: Schema.Types.ObjectId, required: true },
  },
  {
    collection: 'crm_link_tracking',
    timestamps: true,
  },
);

/** Unique tracking URL for redirect lookups */
LinkTrackingSchema.index({ trackingUrl: 1 }, { unique: true });
/** For finding links in a specific message */
LinkTrackingSchema.index({ communicationLogId: 1 });

export const LinkTracking = mongoose.model<ILinkTrackingDocument>(
  'CrmLinkTracking',
  LinkTrackingSchema,
);
