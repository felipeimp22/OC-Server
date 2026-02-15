/**
 * @fileoverview Read-only Mongoose schema for the OrderChop Restaurant model.
 * Maps to the existing `restaurants` collection owned by the Next.js app (Prisma).
 *
 * The CRM engine reads restaurant data for:
 * - Restaurant name (template interpolation)
 * - Branding (email templates: logo, colors)
 * - Contact info (email, phone)
 * - Published/open status
 *
 * **DO NOT write to this collection from the CRM engine.**
 *
 * @module domain/models/external/Restaurant
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the Restaurant document (read-only fields needed by CRM) */
export interface IRestaurantDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  phone: string;
  email: string;
  logo: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  isOpen: boolean;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Read-only Mongoose schema for the OrderChop `restaurants` collection.
 * Fields match the Prisma schema exactly.
 */
const RestaurantSchema = new Schema<IRestaurantDocument>(
  {
    name: { type: String, required: true },
    description: { type: String, default: null },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zipCode: { type: String, required: true },
    country: { type: String, default: 'US' },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    logo: { type: String, default: null },
    primaryColor: { type: String, default: '#282e59' },
    secondaryColor: { type: String, default: '#f03e42' },
    accentColor: { type: String, default: '#ffffff' },
    isOpen: { type: Boolean, default: true },
    isPublished: { type: Boolean, default: false },
  },
  {
    collection: 'restaurants',
    timestamps: true,
    strict: false, // Allow reading fields we haven't explicitly defined
  },
);

/** Read-only Restaurant model — maps to `restaurants` collection */
export const Restaurant = mongoose.model<IRestaurantDocument>('Restaurant', RestaurantSchema);
