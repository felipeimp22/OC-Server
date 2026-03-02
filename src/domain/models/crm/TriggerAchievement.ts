/**
 * @fileoverview CRM Trigger Achievement Mongoose model.
 * Collection: `crm_trigger_achievements`
 *
 * Tracks when a contact reaches an item_ordered_x_times threshold.
 * Used by TriggerService to determine whether to fire (once mode)
 * or reset counting (reset mode) for cumulative triggers.
 *
 * @module domain/models/crm/TriggerAchievement
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** TypeScript interface for the CRM Trigger Achievement document */
export interface ITriggerAchievementDocument extends Document {
  _id: Types.ObjectId;
  /** Restaurant this achievement belongs to */
  restaurantId: Types.ObjectId;
  /** Flow that owns the trigger */
  flowId: Types.ObjectId;
  /** Contact who reached the threshold */
  contactId: Types.ObjectId;
  /** Node ID of the trigger within the flow */
  triggerNodeId: string;
  /** Trigger sub-type (e.g., 'item_ordered_x_times') */
  triggerSubType: string;
  /** When the threshold was reached */
  achievedAt: Date;
  /** Actual count at time of achievement */
  count: number;
  /** Configured threshold that was reached */
  threshold: number;
  /** How many times this achievement has been reset (for reset mode) */
  resetCount: number;
  /** Additional context (e.g., items matched) */
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const TriggerAchievementSchema = new Schema<ITriggerAchievementDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    flowId: { type: Schema.Types.ObjectId, required: true },
    contactId: { type: Schema.Types.ObjectId, required: true },
    triggerNodeId: { type: String, required: true },
    triggerSubType: { type: String, required: true },
    achievedAt: { type: Date, required: true, default: () => new Date() },
    count: { type: Number, required: true },
    threshold: { type: Number, required: true },
    resetCount: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    collection: 'crm_trigger_achievements',
    timestamps: true,
  },
);

/** Primary lookup: find achievements for a contact+flow+trigger combination */
TriggerAchievementSchema.index(
  { restaurantId: 1, flowId: 1, contactId: 1, triggerNodeId: 1 },
);

export const TriggerAchievement = mongoose.model<ITriggerAchievementDocument>(
  'CrmTriggerAchievement',
  TriggerAchievementSchema,
);
