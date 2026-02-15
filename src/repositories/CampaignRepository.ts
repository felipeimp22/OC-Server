/**
 * @fileoverview CRM Campaign repository.
 *
 * @module repositories/CampaignRepository
 */

import type { Types } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { Campaign, type ICampaignDocument } from '../domain/models/crm/Campaign.js';

export class CampaignRepository extends BaseRepository<ICampaignDocument> {
  constructor() {
    super(Campaign, 'CampaignRepository');
  }

  /**
   * Increment campaign stats atomically.
   */
  async incrementStats(
    campaignId: Types.ObjectId | string,
    stats: Partial<Record<'contactsReached' | 'emailsSent' | 'smsSent' | 'revenueAttributed' | 'ordersAttributed', number>>,
  ): Promise<void> {
    const incFields: Record<string, number> = {};
    for (const [key, value] of Object.entries(stats)) {
      if (value) {
        incFields[`stats.${key}`] = value;
      }
    }
    if (Object.keys(incFields).length > 0) {
      await this.model.updateOne({ _id: campaignId }, { $inc: incFields }).exec();
    }
  }
}
