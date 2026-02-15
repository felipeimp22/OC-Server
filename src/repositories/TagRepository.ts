/**
 * @fileoverview CRM Tag repository.
 *
 * @module repositories/TagRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { Tag, type ITagDocument } from '../domain/models/crm/Tag.js';

export class TagRepository extends BaseRepository<ITagDocument> {
  constructor() {
    super(Tag, 'TagRepository');
  }

  /**
   * Find a tag by name within a restaurant.
   */
  async findByName(
    restaurantId: Types.ObjectId | string,
    name: string,
  ): Promise<ITagDocument | null> {
    return this.findOne(restaurantId, { name } as FilterQuery<ITagDocument>);
  }

  /**
   * Find or create a tag by name (for system tag auto-creation).
   */
  async findOrCreate(
    restaurantId: Types.ObjectId | string,
    name: string,
    defaults: Partial<ITagDocument> = {},
  ): Promise<ITagDocument> {
    const existing = await this.findByName(restaurantId, name);
    if (existing) return existing;

    return this.create({
      restaurantId,
      name,
      ...defaults,
    } as Partial<ITagDocument>);
  }

  /**
   * Increment the contactCount for a tag (atomic).
   */
  async incrementContactCount(tagId: Types.ObjectId | string, delta = 1): Promise<void> {
    await this.model.updateOne(
      { _id: tagId },
      { $inc: { contactCount: delta } },
    ).exec();
  }
}
