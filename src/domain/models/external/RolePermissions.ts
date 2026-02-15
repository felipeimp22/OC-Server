/**
 * @fileoverview Read-only Mongoose schema for the OrderChop RolePermissions model.
 * Maps to the existing `role_permissions` collection owned by the Next.js app (Prisma).
 *
 * The CRM engine reads RolePermissions for:
 * - Checking if user's role has `marketing: true` permission (tenancy middleware)
 *
 * **DO NOT write to this collection from the CRM engine.**
 *
 * @module domain/models/external/RolePermissions
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the RolePermissions document (read-only) */
export interface IRolePermissionsDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  role: string; // 'owner' | 'manager' | 'kitchen' | 'staff'
  dashboard: boolean;
  menuManagement: boolean;
  orders: boolean;
  kitchen: boolean;
  customers: boolean;
  /** Marketing / CRM permission — this is what the CRM checks */
  marketing: boolean;
  analytics: boolean;
  settings: boolean;
}

/**
 * Read-only Mongoose schema for the OrderChop `role_permissions` collection.
 */
const RolePermissionsSchema = new Schema<IRolePermissionsDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true },
    dashboard: { type: Boolean, default: false },
    menuManagement: { type: Boolean, default: false },
    orders: { type: Boolean, default: false },
    kitchen: { type: Boolean, default: false },
    customers: { type: Boolean, default: false },
    marketing: { type: Boolean, default: false },
    analytics: { type: Boolean, default: false },
    settings: { type: Boolean, default: false },
  },
  {
    collection: 'role_permissions',
    strict: false,
  },
);

RolePermissionsSchema.index({ restaurantId: 1, role: 1 });

/** Read-only RolePermissions model — maps to `role_permissions` collection */
export const RolePermissions = mongoose.model<IRolePermissionsDocument>(
  'RolePermissions',
  RolePermissionsSchema,
);
