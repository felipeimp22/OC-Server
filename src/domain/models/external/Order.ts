/**
 * @fileoverview Read-only Mongoose schema for the OrderChop Order model.
 * Maps to the existing `orders` collection owned by the Next.js app (Prisma).
 *
 * The CRM engine reads order data for:
 * - Calculating contact stats (totalOrders, lifetimeValue, averageOrderValue)
 * - Order context in flow execution (template interpolation)
 * - Revenue attribution to campaigns
 *
 * **DO NOT write to this collection from the CRM engine.**
 *
 * @module domain/models/external/Order
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Selected option within an order item */
export interface ISelectedOption {
  name: string;
  choice: string;
  priceAdjustment: number;
  quantity?: number;
  portionId?: string;
  portionName?: string;
  portionRatioPercentage?: number;
}

/** Individual item within an order */
export interface IOrderItem {
  menuItemId: Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
  options: ISelectedOption[];
  specialInstructions?: string;
}

/** TypeScript interface for the Order document (read-only fields needed by CRM) */
export interface IOrderDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: Record<string, unknown> | null;
  items: IOrderItem[];
  orderType: string; // 'pickup' | 'delivery' | 'dine_in'
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  subtotal: number;
  tax: number;
  tip: number;
  driverTip: number;
  deliveryFee: number;
  platformFee: number;
  processingFee: number;
  total: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Read-only Mongoose schema for the OrderChop `orders` collection.
 * Fields match the Prisma schema exactly.
 */
const OrderSchema = new Schema<IOrderDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    orderNumber: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, default: null },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, required: true },
    customerAddress: { type: Schema.Types.Mixed, default: null },
    items: { type: [Schema.Types.Mixed] as any, default: [] },
    orderType: { type: String, required: true },
    status: { type: String, default: 'pending' },
    paymentStatus: { type: String, default: 'pending' },
    paymentMethod: { type: String, required: true },
    subtotal: { type: Number, required: true },
    tax: { type: Number, required: true },
    tip: { type: Number, default: 0 },
    driverTip: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    platformFee: { type: Number, default: 0 },
    processingFee: { type: Number, default: 0 },
    total: { type: Number, required: true },
  },
  {
    collection: 'orders',
    timestamps: true,
    strict: false,
  },
);

/** Indexes matching Prisma schema */
OrderSchema.index({ restaurantId: 1, status: 1 });
OrderSchema.index({ restaurantId: 1, customerId: 1 });

/** Read-only Order model — maps to `orders` collection */
export const Order = mongoose.model<IOrderDocument>('Order', OrderSchema);
