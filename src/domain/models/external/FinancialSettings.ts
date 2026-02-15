/**
 * @fileoverview Read-only Mongoose schema for the OrderChop FinancialSettings model.
 * Maps to the existing `financial_settings` collection owned by the Next.js app (Prisma).
 *
 * The CRM engine reads FinancialSettings for:
 * - Currency and currency symbol (for template interpolation of order totals)
 *
 * **DO NOT write to this collection from the CRM engine.**
 *
 * @module domain/models/external/FinancialSettings
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the FinancialSettings document (read-only) */
export interface IFinancialSettingsDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  /** Currency code (e.g., "USD", "BRL") */
  currency: string;
  /** Currency symbol (e.g., "$", "R$") */
  currencySymbol: string;
}

/**
 * Read-only Mongoose schema for the OrderChop `financial_settings` collection.
 * We only need currency fields for CRM template formatting.
 */
const FinancialSettingsSchema = new Schema<IFinancialSettingsDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true, unique: true },
    currency: { type: String, default: 'USD' },
    currencySymbol: { type: String, default: '$' },
  },
  {
    collection: 'financial_settings',
    timestamps: true,
    strict: false,
  },
);

/** Read-only FinancialSettings model — maps to `financial_settings` collection */
export const FinancialSettings = mongoose.model<IFinancialSettingsDocument>(
  'FinancialSettings',
  FinancialSettingsSchema,
);
