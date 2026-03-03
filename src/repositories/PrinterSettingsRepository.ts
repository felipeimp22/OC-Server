/**
 * @fileoverview PrinterSettings repository.
 *
 * Extends BaseRepository with upsert support for per-restaurant
 * printer settings. Each restaurant has at most one settings document.
 *
 * @module repositories/PrinterSettingsRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import {
  PrinterSettings,
  type IPrinterSettingsDocument,
} from '../domain/models/PrinterSettings.js';

export class PrinterSettingsRepository extends BaseRepository<IPrinterSettingsDocument> {
  constructor() {
    super(PrinterSettings, 'PrinterSettingsRepository');
  }

  /**
   * Find printer settings for a restaurant.
   */
  async findByRestaurant(
    restaurantId: Types.ObjectId | string,
  ): Promise<IPrinterSettingsDocument | null> {
    return this.findOne(restaurantId, {} as FilterQuery<IPrinterSettingsDocument>);
  }

  /**
   * Create or update printer settings for a restaurant.
   * Uses upsert to ensure exactly one document per restaurant.
   *
   * @param restaurantId - Tenant ID
   * @param data - Settings fields to set/update
   * @returns The upserted settings document
   */
  async upsert(
    restaurantId: Types.ObjectId | string,
    data: Partial<IPrinterSettingsDocument>,
  ): Promise<IPrinterSettingsDocument> {
    const result = await this.model.findOneAndUpdate(
      { restaurantId } as FilterQuery<IPrinterSettingsDocument>,
      { $set: data, $setOnInsert: { restaurantId } },
      { new: true, upsert: true },
    );
    return result as IPrinterSettingsDocument;
  }

  /**
   * Atomically update a single key in the lastDistributedIndex map.
   * Used by round-robin distribution to persist the next printer index.
   */
  async updateDistributedIndex(
    restaurantId: Types.ObjectId | string,
    indexKey: string,
    value: number,
  ): Promise<void> {
    await this.model.updateOne(
      { restaurantId } as FilterQuery<IPrinterSettingsDocument>,
      { $set: { [`lastDistributedIndex.${indexKey}`]: value } },
    );
  }
}
