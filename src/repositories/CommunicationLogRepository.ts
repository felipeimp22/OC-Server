/**
 * @fileoverview CRM Communication Log repository.
 *
 * Extends BaseRepository with messaging analytics and status tracking.
 *
 * @module repositories/CommunicationLogRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { CommunicationLog, type ICommunicationLogDocument } from '../domain/models/crm/CommunicationLog.js';

export class CommunicationLogRepository extends BaseRepository<ICommunicationLogDocument> {
  constructor() {
    super(CommunicationLog, 'CommunicationLogRepository');
  }

  /**
   * Find by provider message ID (for webhook callbacks from email/SMS providers).
   */
  async findByProviderMessageId(
    providerMessageId: string,
  ): Promise<ICommunicationLogDocument | null> {
    return this.model.findOne({ providerMessageId }).exec();
  }

  /**
   * Find communication history for a contact.
   */
  async findByContact(
    restaurantId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
    limit = 50,
  ): Promise<ICommunicationLogDocument[]> {
    return this.model.find({ restaurantId, contactId } as FilterQuery<ICommunicationLogDocument>)
      .sort({ sentAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Get messaging stats for a restaurant (counts by status and channel).
   * Used for the analytics dashboard.
   */
  async getMessagingStats(
    restaurantId: Types.ObjectId | string,
    since?: Date,
  ): Promise<Array<{ channel: string; status: string; count: number }>> {
    const match: Record<string, unknown> = {
      restaurantId: typeof restaurantId === 'string'
        ? new this.model.base.Types.ObjectId(restaurantId)
        : restaurantId,
    };
    if (since) {
      match.sentAt = { $gte: since };
    }

    return this.model.aggregate([
      { $match: match },
      { $group: { _id: { channel: '$channel', status: '$status' }, count: { $sum: 1 } } },
      { $project: { _id: 0, channel: '$_id.channel', status: '$_id.status', count: 1 } },
    ]).exec();
  }

  /**
   * Update communication status (for delivery/open/click tracking).
   */
  async updateStatus(
    id: Types.ObjectId | string,
    status: string,
    timestampField?: 'deliveredAt' | 'openedAt' | 'clickedAt',
  ): Promise<ICommunicationLogDocument | null> {
    const update: Record<string, unknown> = { status };
    if (timestampField) {
      update[timestampField] = new Date();
    }
    return this.model.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
  }
}
