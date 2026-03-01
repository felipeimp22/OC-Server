/**
 * @fileoverview CRM Contact Mongoose model.
 * Collection: `crm_contacts`
 *
 * Mirrors and extends the existing OrderChop Customer with CRM-specific fields.
 * On every `customer.created` or `order.completed` event, the CRM engine syncs
 * data from the main Customer + Order collections into this collection.
 *
 * The existing Customer model in the Next.js app remains the source of truth
 * for basic customer data. The CRM contact is an enriched view.
 *
 * @module domain/models/crm/Contact
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Phone number structure (mirrored from Customer) */
export interface IContactPhone {
  countryCode: string;
  number: string;
}

/** TypeScript interface for the CRM Contact document */
export interface IContactDocument extends Document {
  _id: Types.ObjectId;
  /** Tenant isolation — every query must filter by this */
  restaurantId: Types.ObjectId;
  /** Reference to the original Customer._id in the OrderChop `customers` collection */
  customerId: Types.ObjectId;
  /** Customer email (synced from Customer) */
  email: string;
  /** Customer phone (synced from Customer) */
  phone: IContactPhone | null;
  /** First name (split from Customer.name on sync) */
  firstName: string;
  /** Last name (split from Customer.name on sync) */
  lastName: string;
  /** Whether the contact opted in to receive emails (null = opted in by default, false = explicit opt-out) */
  emailOptIn: boolean | null;
  /** Timestamp of email opt-in */
  emailOptInAt: Date | null;
  /** Whether the contact opted in to receive SMS (null = opted in by default, false = explicit opt-out) */
  smsOptIn: boolean | null;
  /** Timestamp of SMS opt-in */
  smsOptInAt: Date | null;
  /** CRM lifecycle status */
  lifecycleStatus: string;
  /** Tags applied to this contact (refs to crm_tags) */
  tags: Types.ObjectId[];
  /** Flexible key-value custom fields defined per restaurant */
  customFields: Record<string, unknown>;
  /** Timestamp of the contact's most recent order */
  lastOrderAt: Date | null;
  /** Total number of completed orders (denormalized) */
  totalOrders: number;
  /** Total revenue from all completed orders (denormalized) */
  lifetimeValue: number;
  /** Average order value = lifetimeValue / totalOrders (denormalized) */
  averageOrderValue: number;
  /** Timestamp of last review request sent to this contact */
  lastReviewRequestAt: Date | null;
  /** How the contact was acquired (QR, campaign, direct, etc.) */
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema<IContactDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, required: true },
    email: { type: String, required: true },
    phone: { type: Schema.Types.Mixed, default: null },
    firstName: { type: String, required: true },
    lastName: { type: String, default: '' },
    emailOptIn: { type: Boolean, default: null },
    emailOptInAt: { type: Date, default: null },
    smsOptIn: { type: Boolean, default: null },
    smsOptInAt: { type: Date, default: null },
    lifecycleStatus: {
      type: String,
      enum: ['lead', 'first_time', 'returning', 'lost', 'recovered', 'VIP'],
      default: 'lead',
    },
    tags: { type: [Schema.Types.ObjectId], default: [] },
    customFields: { type: Schema.Types.Mixed, default: {} },
    lastOrderAt: { type: Date, default: null },
    totalOrders: { type: Number, default: 0, min: 0 },
    lifetimeValue: { type: Number, default: 0, min: 0 },
    averageOrderValue: { type: Number, default: 0, min: 0 },
    lastReviewRequestAt: { type: Date, default: null },
    source: { type: String, default: null },
  },
  {
    collection: 'crm_contacts',
    timestamps: true,
  },
);

/** Unique constraint: one CRM contact per customer per restaurant */
ContactSchema.index({ restaurantId: 1, email: 1 }, { unique: true });
/** For querying by lifecycle segment */
ContactSchema.index({ restaurantId: 1, lifecycleStatus: 1 });
/** For inactivity checks (no order in X days) */
ContactSchema.index({ restaurantId: 1, lastOrderAt: 1 });
/** For tag-based filtering */
ContactSchema.index({ restaurantId: 1, tags: 1 });
/** For syncing from customerId */
ContactSchema.index({ restaurantId: 1, customerId: 1 }, { unique: true });

export const Contact = mongoose.model<IContactDocument>('CrmContact', ContactSchema);
