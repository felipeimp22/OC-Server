/**
 * @fileoverview CRM Custom Field repository.
 *
 * @module repositories/CustomFieldRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { CustomField, type ICustomFieldDocument } from '../domain/models/crm/CustomField.js';

export class CustomFieldRepository extends BaseRepository<ICustomFieldDocument> {
  constructor() {
    super(CustomField, 'CustomFieldRepository');
  }

  /**
   * Find a custom field by its key within a restaurant.
   */
  async findByKey(
    restaurantId: Types.ObjectId | string,
    key: string,
  ): Promise<ICustomFieldDocument | null> {
    return this.findOne(restaurantId, { key } as FilterQuery<ICustomFieldDocument>);
  }

  /**
   * Get all custom fields for a restaurant, ordered by display order.
   */
  async findAllOrdered(
    restaurantId: Types.ObjectId | string,
  ): Promise<ICustomFieldDocument[]> {
    return this.model.find({ restaurantId } as FilterQuery<ICustomFieldDocument>)
      .sort({ order: 1 })
      .exec();
  }
}
