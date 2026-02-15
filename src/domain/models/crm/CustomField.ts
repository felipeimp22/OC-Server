/**
 * @fileoverview CRM Custom Field Mongoose model.
 * Collection: `crm_custom_fields`
 *
 * Custom fields allow restaurants to add arbitrary data fields to contacts.
 * Defined per restaurant with a type system (text, number, date, dropdown, checkbox).
 * The actual values are stored in the contact's `customFields` map.
 *
 * @module domain/models/crm/CustomField
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Supported custom field types */
export type CustomFieldType = 'text' | 'number' | 'date' | 'dropdown' | 'checkbox';

/** TypeScript interface for the CRM CustomField document */
export interface ICustomFieldDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  /** Display name */
  name: string;
  /** Slugified key used in contact.customFields map */
  key: string;
  /** Field data type */
  fieldType: CustomFieldType;
  /** Available options (only used when fieldType = "dropdown") */
  options: string[];
  /** Whether the field is required when creating/updating contacts */
  isRequired: boolean;
  /** Display order in the UI */
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const CustomFieldSchema = new Schema<ICustomFieldDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    key: { type: String, required: true },
    fieldType: {
      type: String,
      enum: ['text', 'number', 'date', 'dropdown', 'checkbox'],
      required: true,
    },
    options: { type: [String], default: [] },
    isRequired: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  {
    collection: 'crm_custom_fields',
    timestamps: true,
  },
);

/** Unique field key per restaurant */
CustomFieldSchema.index({ restaurantId: 1, key: 1 }, { unique: true });

export const CustomField = mongoose.model<ICustomFieldDocument>('CrmCustomField', CustomFieldSchema);
