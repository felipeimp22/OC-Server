/**
 * @fileoverview Read-only Mongoose schema for the OrderChop User model.
 * Maps to the existing `users` collection owned by the Next.js app (Prisma).
 *
 * The CRM engine reads User for staff email lookups in send_email action nodes.
 *
 * **DO NOT write to this collection from the CRM engine.**
 *
 * @module domain/models/external/User
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the User document (read-only fields needed by CRM) */
export interface IUserDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
}

/**
 * Read-only Mongoose schema for the OrderChop `users` collection.
 */
const UserSchema = new Schema<IUserDocument>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
  },
  {
    collection: 'users',
    strict: false,
  },
);

/** Read-only User model — maps to `users` collection */
export const User = mongoose.model<IUserDocument>('User', UserSchema);
