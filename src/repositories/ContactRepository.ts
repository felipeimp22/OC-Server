/**
 * @fileoverview CRM Contact repository.
 *
 * Extends BaseRepository with contact-specific query methods for:
 * - Syncing from OrderChop Customer on customer.created / order.completed
 * - Updating denormalized order stats (totalOrders, lifetimeValue, etc.)
 * - Tag management (apply/remove)
 * - Lifecycle status queries and updates
 * - Segmentation queries (by tag, lifecycle, activity)
 *
 * @module repositories/ContactRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { Contact, type IContactDocument } from '../domain/models/crm/Contact.js';

export class ContactRepository extends BaseRepository<IContactDocument> {
  constructor() {
    super(Contact, 'ContactRepository');
  }

  /**
   * Find a contact by the OrderChop customer ID.
   * Used during customer event sync to find existing CRM contacts.
   */
  async findByCustomerId(
    restaurantId: Types.ObjectId | string,
    customerId: Types.ObjectId | string,
  ): Promise<IContactDocument | null> {
    return this.findOne(restaurantId, { customerId } as FilterQuery<IContactDocument>);
  }

  /**
   * Find a contact by email address.
   */
  async findByEmail(
    restaurantId: Types.ObjectId | string,
    email: string,
  ): Promise<IContactDocument | null> {
    return this.findOne(restaurantId, { email } as FilterQuery<IContactDocument>);
  }

  /**
   * Upsert a contact by customerId. Used for syncing from OrderChop Customer.
   * Creates if not found, updates if already exists.
   *
   * @param onInsertData - Extra fields applied only on document creation (via $setOnInsert).
   *                       Use for fields that should default on new contacts but not be overwritten on updates.
   */
  async upsertByCustomerId(
    restaurantId: Types.ObjectId | string,
    customerId: Types.ObjectId | string,
    data: Partial<IContactDocument>,
    onInsertData?: Partial<IContactDocument>,
  ): Promise<IContactDocument> {
    const result = await this.model.findOneAndUpdate(
      { restaurantId, customerId } as FilterQuery<IContactDocument>,
      { $set: data, $setOnInsert: { restaurantId, customerId, ...onInsertData } },
      { new: true, upsert: true },
    ).exec();
    return result!;
  }

  /**
   * Increment order stats after a completed order.
   * Uses atomic $inc to avoid race conditions in concurrent processing.
   */
  async incrementOrderStats(
    restaurantId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
    orderTotal: number,
  ): Promise<IContactDocument | null> {
    const contact = await this.model.findOneAndUpdate(
      { _id: contactId, restaurantId } as FilterQuery<IContactDocument>,
      {
        $inc: { totalOrders: 1, lifetimeValue: orderTotal },
        $set: { lastOrderAt: new Date() },
      },
      { new: true },
    ).exec();

    // Recalculate average (can't use $inc for division)
    if (contact && contact.totalOrders > 0) {
      contact.averageOrderValue = contact.lifetimeValue / contact.totalOrders;
      await contact.save();
    }

    return contact;
  }

  /**
   * Apply a tag to a contact (addToSet — no duplicates).
   */
  async applyTag(
    restaurantId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
    tagId: Types.ObjectId | string,
  ): Promise<IContactDocument | null> {
    return this.model.findOneAndUpdate(
      { _id: contactId, restaurantId } as FilterQuery<IContactDocument>,
      { $addToSet: { tags: tagId } },
      { new: true },
    ).exec();
  }

  /**
   * Remove a tag from a contact.
   */
  async removeTag(
    restaurantId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
    tagId: Types.ObjectId | string,
  ): Promise<IContactDocument | null> {
    return this.model.findOneAndUpdate(
      { _id: contactId, restaurantId } as FilterQuery<IContactDocument>,
      { $pull: { tags: tagId } },
      { new: true },
    ).exec();
  }

  /**
   * Find contacts by lifecycle status.
   */
  async findByLifecycle(
    restaurantId: Types.ObjectId | string,
    lifecycleStatus: string,
  ): Promise<IContactDocument[]> {
    return this.find(restaurantId, { lifecycleStatus } as FilterQuery<IContactDocument>);
  }

  /**
   * Find inactive contacts (no order in X days).
   * Excludes contacts with no orders (lastOrderAt is null).
   * Used by the InactivityChecker scheduler.
   */
  async findInactive(
    restaurantId: Types.ObjectId | string,
    daysSinceLastOrder: number,
  ): Promise<IContactDocument[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysSinceLastOrder);

    return this.find(restaurantId, {
      lastOrderAt: { $ne: null, $lt: cutoffDate },
    } as FilterQuery<IContactDocument>);
  }

  /**
   * Bulk update lifecycle status for multiple contacts.
   */
  async bulkUpdateLifecycle(
    restaurantId: Types.ObjectId | string,
    contactIds: (Types.ObjectId | string)[],
    lifecycleStatus: string,
  ): Promise<number> {
    const result = await this.model.updateMany(
      { _id: { $in: contactIds }, restaurantId } as FilterQuery<IContactDocument>,
      { $set: { lifecycleStatus } },
    ).exec();
    return result.modifiedCount;
  }

  /**
   * Find contacts matching a tag filter.
   */
  async findByTags(
    restaurantId: Types.ObjectId | string,
    tagIds: (Types.ObjectId | string)[],
    matchAll = false,
  ): Promise<IContactDocument[]> {
    const tagFilter = matchAll
      ? { tags: { $all: tagIds } }
      : { tags: { $in: tagIds } };

    return this.find(restaurantId, tagFilter as FilterQuery<IContactDocument>);
  }

  /**
   * Get segment counts (contacts per lifecycle status).
   * Used for the analytics dashboard.
   * Always returns all 6 lifecycle statuses, defaulting to 0 if none exist.
   */
  async getSegmentCounts(
    restaurantId: Types.ObjectId | string,
  ): Promise<Record<string, number>> {
    const results = await this.model.aggregate([
      { $match: { restaurantId: typeof restaurantId === 'string' ? new this.model.base.Types.ObjectId(restaurantId) : restaurantId } },
      { $group: { _id: '$lifecycleStatus', count: { $sum: 1 } } },
    ]).exec();

    const segments: Record<string, number> = {
      lead: 0,
      first_time: 0,
      returning: 0,
      lost: 0,
      recovered: 0,
      VIP: 0,
    };
    for (const r of results) {
      segments[r._id as string] = r.count;
    }
    return segments;
  }

  /**
   * Count contacts created this month.
   */
  async countNewThisMonth(restaurantId: Types.ObjectId | string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.model.countDocuments({
      restaurantId,
      createdAt: { $gte: startOfMonth },
    }).exec();
  }
}
