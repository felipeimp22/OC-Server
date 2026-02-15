/**
 * @fileoverview Read-only Mongoose schema for the OrderChop Customer model.
 * Maps to the existing `customers` collection owned by the Next.js app (Prisma).
 *
 * The CRM engine reads customer data for:
 * - Syncing into crm_contacts on customer.created events
 * - Looking up customer details for contact enrichment
 *
 * **DO NOT write to this collection from the CRM engine.**
 *
 * @module domain/models/external/Customer
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Phone number structure (stored as Json in Prisma) */
export interface ICustomerPhone {
  countryCode: string;
  number: string;
}

/** Address structure (stored as Json in Prisma) */
export interface ICustomerAddress {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  [key: string]: unknown;
}

/** TypeScript interface for the Customer document (read-only fields needed by CRM) */
export interface ICustomerDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  name: string;
  email: string;
  phone: ICustomerPhone | null;
  address: ICustomerAddress | null;
  tags: string[];
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Read-only Mongoose schema for the OrderChop `customers` collection.
 * Fields match the Prisma schema exactly.
 */
const CustomerSchema = new Schema<ICustomerDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: Schema.Types.Mixed, default: null },
    address: { type: Schema.Types.Mixed, default: null },
    tags: { type: [String], default: [] },
    notes: { type: String, default: null },
  },
  {
    collection: 'customers',
    timestamps: true,
    strict: false,
  },
);

/** Unique constraint matching Prisma's @@unique([restaurantId, email]) */
CustomerSchema.index({ restaurantId: 1, email: 1 }, { unique: true });

/** Read-only Customer model — maps to `customers` collection */
export const Customer = mongoose.model<ICustomerDocument>('Customer', CustomerSchema);
