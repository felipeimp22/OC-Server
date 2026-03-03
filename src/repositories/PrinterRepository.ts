/**
 * @fileoverview Printer repository.
 *
 * Extends BaseRepository with printer-specific query methods for:
 * - Finding printers by restaurant
 * - Finding enabled printers matching order type
 * - CRUD operations scoped to restaurantId
 *
 * @module repositories/PrinterRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { Printer, type IPrinterDocument } from '../domain/models/Printer.js';

export class PrinterRepository extends BaseRepository<IPrinterDocument> {
  constructor() {
    super(Printer, 'PrinterRepository');
  }

  /**
   * Find all printers for a restaurant.
   */
  async findByRestaurant(restaurantId: Types.ObjectId | string): Promise<IPrinterDocument[]> {
    return this.find(restaurantId);
  }

  /**
   * Find enabled printers for a restaurant that handle a specific order type.
   *
   * @param restaurantId - Tenant ID
   * @param orderType - Order type to match (e.g., 'pickup', 'delivery', 'dineIn')
   * @returns Enabled printers whose orderTypes array includes the given type
   */
  async findEnabledByRestaurantAndOrderType(
    restaurantId: Types.ObjectId | string,
    orderType: string,
  ): Promise<IPrinterDocument[]> {
    return this.find(restaurantId, {
      enabled: true,
      orderTypes: orderType,
    } as FilterQuery<IPrinterDocument>);
  }
}
