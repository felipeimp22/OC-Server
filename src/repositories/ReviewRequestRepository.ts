/**
 * @fileoverview CRM Review Request repository.
 *
 * @module repositories/ReviewRequestRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { ReviewRequest, type IReviewRequestDocument } from '../domain/models/crm/ReviewRequest.js';

export class ReviewRequestRepository extends BaseRepository<IReviewRequestDocument> {
  constructor() {
    super(ReviewRequest, 'ReviewRequestRepository');
  }

  /**
   * Check if a review request already exists for a given order.
   * Enforces the "one review request per order" rule.
   */
  async existsForOrder(
    restaurantId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
    orderId: Types.ObjectId | string,
  ): Promise<boolean> {
    const count = await this.model.countDocuments({
      restaurantId,
      contactId,
      orderId,
    } as FilterQuery<IReviewRequestDocument>).exec();
    return count > 0;
  }

  /**
   * Check if a review request was recently sent (cooldown check).
   *
   * @param restaurantId - Tenant ID
   * @param contactId - Contact ID
   * @param cooldownDays - Minimum days between review requests
   * @returns true if a request was sent within the cooldown period
   */
  async isInCooldown(
    restaurantId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
    cooldownDays: number,
  ): Promise<boolean> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - cooldownDays);

    const count = await this.model.countDocuments({
      restaurantId,
      contactId,
      sentAt: { $gte: cutoff },
      status: { $in: ['sent', 'clicked'] },
    } as FilterQuery<IReviewRequestDocument>).exec();
    return count > 0;
  }

  /**
   * Find scheduled review requests that are ready to be sent.
   * Used by ReviewRequestScheduler cron job.
   */
  async findReadyToSend(limit = 100): Promise<IReviewRequestDocument[]> {
    return this.model.find({
      status: 'scheduled',
      scheduledAt: { $lte: new Date() },
    } as FilterQuery<IReviewRequestDocument>)
      .limit(limit)
      .exec();
  }
}
