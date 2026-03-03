/**
 * @fileoverview PrinterSettings Mongoose model.
 * Collection: `printer_settings`
 *
 * Stores per-restaurant global printer configuration: auto-print behavior,
 * order type toggles, concurrency limits, and email sender address.
 * One document per restaurant (upsert pattern).
 *
 * @module domain/models/PrinterSettings
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the PrinterSettings document */
export interface IPrinterSettingsDocument extends Document {
  _id: Types.ObjectId;
  /** Tenant isolation — one settings doc per restaurant */
  restaurantId: Types.ObjectId;
  /** Master toggle — is printing enabled for this restaurant? */
  enabled: boolean;
  /** Automatically print on order completion */
  autoPrint: boolean;
  /** Print pickup orders */
  printPickup: boolean;
  /** Print delivery orders */
  printDelivery: boolean;
  /** Print dine-in orders */
  printDineIn: boolean;
  /** Max concurrent print jobs across all printers (internal — not user-configurable via API) */
  globalConcurrency: number;
  /**
   * How orders are distributed when multiple printers match:
   * - 'duplicate': every matching printer gets every order (default)
   * - 'distribute': orders round-robin across matching printers
   */
  distributionMode: 'duplicate' | 'distribute';
  /**
   * Round-robin position per order type key (e.g., { 'pickup': 1, 'delivery': 0, 'kitchen_pickup': 2 }).
   * Only used when distributionMode is 'distribute'.
   */
  lastDistributedIndex: Map<string, number>;
  /** Receipt font size preset */
  fontSize: 'small' | 'normal' | 'large';
  /** Custom "from" email for print emails (overrides default) */
  emailFrom?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PrinterSettingsSchema = new Schema<IPrinterSettingsDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    autoPrint: { type: Boolean, default: true },
    printPickup: { type: Boolean, default: true },
    printDelivery: { type: Boolean, default: true },
    printDineIn: { type: Boolean, default: true },
    globalConcurrency: { type: Number, default: 2 },
    distributionMode: {
      type: String,
      enum: ['duplicate', 'distribute'],
      default: 'duplicate',
    },
    lastDistributedIndex: {
      type: Map,
      of: Number,
      default: {},
    },
    fontSize: {
      type: String,
      enum: ['small', 'normal', 'large'],
      default: 'normal',
    },
    emailFrom: { type: String },
  },
  {
    collection: 'printer_settings',
    timestamps: true,
  },
);

export const PrinterSettings = mongoose.model<IPrinterSettingsDocument>(
  'PrinterSettings',
  PrinterSettingsSchema,
);
