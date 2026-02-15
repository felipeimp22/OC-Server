/**
 * @fileoverview CRM Communication Log Mongoose model.
 * Collection: `crm_communication_logs`
 *
 * Records every email/SMS sent from the CRM engine. Tracks delivery lifecycle
 * (queued → sent → delivered → opened → clicked) with timestamps at each stage.
 *
 * Links to the flow execution that triggered the send (if applicable)
 * and the template used.
 *
 * @module domain/models/crm/CommunicationLog
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Communication delivery lifecycle statuses */
export type CommunicationStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'failed'
  | 'unsubscribed';

/** TypeScript interface for the CRM CommunicationLog document */
export interface ICommunicationLogDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  /** Contact who received the message */
  contactId: Types.ObjectId;
  /** Channel used */
  channel: string;
  /** Template used (null if ad-hoc) */
  templateId: Types.ObjectId | null;
  /** Flow that triggered this message (null if manual) */
  flowId: Types.ObjectId | null;
  /** Specific execution that triggered this message */
  executionId: Types.ObjectId | null;
  /** Recipient address (email or phone number) */
  to: string;
  /** Email subject (null for SMS) */
  subject: string | null;
  /** Current delivery status */
  status: CommunicationStatus;
  /** Provider-specific message ID (for delivery tracking callbacks) */
  providerMessageId: string | null;
  /** Additional provider metadata (bounce reason, etc.) */
  metadata: Record<string, unknown>;
  /** When the message was queued/sent */
  sentAt: Date;
  /** When the provider confirmed delivery */
  deliveredAt: Date | null;
  /** When the recipient opened the message (email only) */
  openedAt: Date | null;
  /** When the recipient clicked a link */
  clickedAt: Date | null;
}

const CommunicationLogSchema = new Schema<ICommunicationLogDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    contactId: { type: Schema.Types.ObjectId, required: true },
    channel: { type: String, enum: ['email', 'sms'], required: true },
    templateId: { type: Schema.Types.ObjectId, default: null },
    flowId: { type: Schema.Types.ObjectId, default: null },
    executionId: { type: Schema.Types.ObjectId, default: null },
    to: { type: String, required: true },
    subject: { type: String, default: null },
    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'unsubscribed'],
      default: 'queued',
    },
    providerMessageId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    sentAt: { type: Date, default: () => new Date() },
    deliveredAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    clickedAt: { type: Date, default: null },
  },
  {
    collection: 'crm_communication_logs',
    timestamps: false, // We track individual timestamps instead
  },
);

/** For contact communication history */
CommunicationLogSchema.index({ contactId: 1 });
/** For flow-level messaging analytics */
CommunicationLogSchema.index({ flowId: 1 });
/** For restaurant-level messaging stats */
CommunicationLogSchema.index({ restaurantId: 1, status: 1 });
/** For time-based analytics (dashboard charts) */
CommunicationLogSchema.index({ restaurantId: 1, sentAt: -1 });
/** For provider callback lookups */
CommunicationLogSchema.index({ providerMessageId: 1 }, { sparse: true });

export const CommunicationLog = mongoose.model<ICommunicationLogDocument>(
  'CrmCommunicationLog',
  CommunicationLogSchema,
);
