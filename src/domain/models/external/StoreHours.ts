/**
 * @fileoverview Read-only Mongoose schema for the OrderChop StoreHours model.
 * Maps to the existing `store_hours` collection owned by the Next.js app (Prisma).
 *
 * The CRM engine reads StoreHours for:
 * - Restaurant timezone (used by all timer/scheduling operations)
 *
 * **DO NOT write to this collection from the CRM engine.**
 *
 * @module domain/models/external/StoreHours
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the StoreHours document (read-only) */
export interface IStoreHoursDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  /** Restaurant timezone (e.g., "America/New_York") — key CRM field */
  timezone: string;
}

/**
 * Read-only Mongoose schema for the OrderChop `store_hours` collection.
 * We only need the timezone field for CRM scheduling.
 */
const StoreHoursSchema = new Schema<IStoreHoursDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true, unique: true },
    timezone: { type: String, default: 'America/New_York' },
  },
  {
    collection: 'store_hours',
    timestamps: true,
    strict: false,
  },
);

/** Read-only StoreHours model — maps to `store_hours` collection */
export const StoreHours = mongoose.model<IStoreHoursDocument>('StoreHours', StoreHoursSchema);
