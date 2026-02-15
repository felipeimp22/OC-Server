/**
 * @fileoverview CRM Campaign Mongoose model.
 * Collection: `crm_campaigns`
 *
 * Campaigns group multiple flows and communication sends for tracking
 * revenue attribution. When a contact who participated in a campaign
 * places an order, the revenue is attributed to the campaign.
 *
 * @module domain/models/crm/Campaign
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Campaign lifecycle statuses */
export type CampaignStatus = 'draft' | 'active' | 'completed' | 'archived';

/** TypeScript interface for the CRM Campaign document */
export interface ICampaignDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  /** Campaign display name */
  name: string;
  /** Optional description */
  description: string | null;
  /** Campaign lifecycle status */
  status: CampaignStatus;
  /** Flows associated with this campaign */
  flowIds: Types.ObjectId[];
  /** Source identifier for tracking (used in UTM params, QR codes, etc.) */
  source: string | null;
  /** Denormalized stats */
  stats: {
    /** Total contacts reached */
    contactsReached: number;
    /** Total emails sent */
    emailsSent: number;
    /** Total SMS sent */
    smsSent: number;
    /** Total revenue attributed to this campaign */
    revenueAttributed: number;
    /** Total orders placed by campaign contacts */
    ordersAttributed: number;
  };
  /** Campaign start date */
  startedAt: Date | null;
  /** Campaign end date */
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignStatsSchema = new Schema(
  {
    contactsReached: { type: Number, default: 0 },
    emailsSent: { type: Number, default: 0 },
    smsSent: { type: Number, default: 0 },
    revenueAttributed: { type: Number, default: 0 },
    ordersAttributed: { type: Number, default: 0 },
  },
  { _id: false },
);

const CampaignSchema = new Schema<ICampaignDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    status: {
      type: String,
      enum: ['draft', 'active', 'completed', 'archived'],
      default: 'draft',
    },
    flowIds: { type: [Schema.Types.ObjectId], default: [] },
    source: { type: String, default: null },
    stats: {
      type: CampaignStatsSchema,
      default: () => ({
        contactsReached: 0,
        emailsSent: 0,
        smsSent: 0,
        revenueAttributed: 0,
        ordersAttributed: 0,
      }),
    },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  {
    collection: 'crm_campaigns',
    timestamps: true,
  },
);

CampaignSchema.index({ restaurantId: 1, status: 1 });

export const Campaign = mongoose.model<ICampaignDocument>('CrmCampaign', CampaignSchema);
