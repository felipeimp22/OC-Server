/**
 * @fileoverview CRM Communication Template Mongoose model.
 * Collection: `crm_communication_templates`
 *
 * Email and SMS templates with {{variable}} interpolation support.
 * System templates (for review requests) are auto-created and cannot be deleted.
 *
 * Variables are resolved at send time using the contact, restaurant, and order context:
 * - {{first_name}}, {{last_name}}, {{email}}
 * - {{restaurant_name}}, {{restaurant_phone}}
 * - {{order_total}}, {{order_number}}, {{order_type}}
 * - {{review_link}}, {{promo_code}}
 * - Any custom field key
 *
 * @module domain/models/crm/CommunicationTemplate
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the CRM CommunicationTemplate document */
export interface ICommunicationTemplateDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  /** Channel: email or sms */
  channel: string;
  /** Template display name */
  name: string;
  /** Email subject line (null for SMS) — supports {{variable}} interpolation */
  subject: string | null;
  /** Template body — HTML for email, plain text for SMS — supports {{variable}} interpolation */
  body: string;
  /** Whether this is a system template (cannot be deleted) */
  isSystem: boolean;
  /** List of available variable names for this template */
  variables: string[];
  createdAt: Date;
  updatedAt: Date;
}

const CommunicationTemplateSchema = new Schema<ICommunicationTemplateDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    channel: {
      type: String,
      enum: ['email', 'sms'],
      required: true,
    },
    name: { type: String, required: true },
    subject: { type: String, default: null },
    body: { type: String, required: true },
    isSystem: { type: Boolean, default: false },
    variables: { type: [String], default: [] },
  },
  {
    collection: 'crm_communication_templates',
    timestamps: true,
  },
);

/** For listing templates per restaurant and channel */
CommunicationTemplateSchema.index({ restaurantId: 1, channel: 1 });

export const CommunicationTemplate = mongoose.model<ICommunicationTemplateDocument>(
  'CrmCommunicationTemplate',
  CommunicationTemplateSchema,
);
