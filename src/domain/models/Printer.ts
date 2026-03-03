/**
 * @fileoverview Printer Mongoose model.
 * Collection: `printers`
 *
 * Stores registered Star Micronics printer configurations per restaurant.
 * Each printer has a device email that receives HTML receipts via Mailgun.
 *
 * @module domain/models/Printer
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Printer hardware type */
export type PrinterType = 'receipt' | 'kitchen';

/** TypeScript interface for the Printer document */
export interface IPrinterDocument extends Document {
  _id: Types.ObjectId;
  /** Tenant isolation — every query must filter by this */
  restaurantId: Types.ObjectId;
  /** Human-readable printer name (e.g., "Front Counter", "Kitchen") */
  name: string;
  /** Star Micronics device email address */
  email: string;
  /** Printer type — receipt (customer-facing) or kitchen (back-of-house) */
  type: PrinterType;
  /** Whether this printer is active */
  enabled: boolean;
  /** Which order types this printer handles */
  orderTypes: string[];
  /** Max concurrent print jobs for this printer */
  concurrency: number;
  createdAt: Date;
  updatedAt: Date;
}

const PrinterSchema = new Schema<IPrinterDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    type: {
      type: String,
      enum: ['receipt', 'kitchen'],
      default: 'receipt',
    },
    enabled: { type: Boolean, default: true },
    orderTypes: { type: [String], default: ['pickup', 'delivery', 'dineIn'] },
    concurrency: { type: Number, default: 1 },
  },
  {
    collection: 'printers',
    timestamps: true,
  },
);

/** Prevent duplicate printer emails per restaurant */
PrinterSchema.index({ restaurantId: 1, email: 1 }, { unique: true });

export const Printer = mongoose.model<IPrinterDocument>('Printer', PrinterSchema);
