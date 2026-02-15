/**
 * @fileoverview Read-only Mongoose schema for the OrderChop UserRestaurant model.
 * Maps to the existing `user_restaurants` collection owned by the Next.js app (Prisma).
 *
 * The CRM engine reads UserRestaurant for:
 * - Validating that a user has access to a restaurant (auth middleware)
 * - Checking user role (owner, manager, kitchen, staff)
 *
 * **DO NOT write to this collection from the CRM engine.**
 *
 * @module domain/models/external/UserRestaurant
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the UserRestaurant document (read-only) */
export interface IUserRestaurantDocument extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  restaurantId: Types.ObjectId;
  role: string; // 'owner' | 'manager' | 'kitchen' | 'staff'
}

/**
 * Read-only Mongoose schema for the OrderChop `user_restaurants` collection.
 */
const UserRestaurantSchema = new Schema<IUserRestaurantDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true },
  },
  {
    collection: 'user_restaurants',
    strict: false,
  },
);

UserRestaurantSchema.index({ userId: 1, restaurantId: 1 }, { unique: true });

/** Read-only UserRestaurant model — maps to `user_restaurants` collection */
export const UserRestaurant = mongoose.model<IUserRestaurantDocument>(
  'UserRestaurant',
  UserRestaurantSchema,
);
