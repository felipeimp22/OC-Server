/**
 * @fileoverview Repository for CRM Trigger Achievement records.
 *
 * Provides methods to track and query threshold achievements
 * for cumulative triggers like item_ordered_x_times.
 *
 * @module repositories/TriggerAchievementRepository
 */

import { BaseRepository } from './base/BaseRepository.js';
import {
  TriggerAchievement,
  type ITriggerAchievementDocument,
} from '../domain/models/crm/TriggerAchievement.js';
import type { FilterQuery, Types } from 'mongoose';

export class TriggerAchievementRepository extends BaseRepository<ITriggerAchievementDocument> {
  constructor() {
    super(TriggerAchievement, 'TriggerAchievementRepository');
  }

  /**
   * Find the most recent achievement for a contact+flow+trigger combination.
   * Used to determine if the trigger has already fired (once mode)
   * or to get the sinceDate for counting (reset mode).
   */
  async findLatest(
    restaurantId: Types.ObjectId | string,
    flowId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
    triggerNodeId: string,
  ): Promise<ITriggerAchievementDocument | null> {
    return this.model
      .findOne({
        restaurantId,
        flowId,
        contactId,
        triggerNodeId,
      } as FilterQuery<ITriggerAchievementDocument>)
      .sort({ achievedAt: -1 })
      .exec();
  }

  /**
   * Atomically increment the resetCount on an achievement record.
   * Called when the trigger fires again in reset mode.
   */
  async incrementResetCount(
    id: Types.ObjectId | string,
  ): Promise<ITriggerAchievementDocument | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        { $inc: { resetCount: 1 } },
        { new: true },
      )
      .exec();
  }
}
