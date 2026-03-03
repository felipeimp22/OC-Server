/**
 * @fileoverview PrintJob repository.
 *
 * Extends BaseRepository with print-job-specific query methods for:
 * - Finding jobs by restaurant with optional filters
 * - Updating job status with extra fields (sentAt, lastError)
 * - Finding pending jobs for a specific printer
 * - Aggregating job stats by status
 *
 * @module repositories/PrintJobRepository
 */

import type { Types, FilterQuery, UpdateQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { PrintJob, type IPrintJobDocument, type PrintJobStatus } from '../domain/models/PrintJob.js';

export class PrintJobRepository extends BaseRepository<IPrintJobDocument> {
  constructor() {
    super(PrintJob, 'PrintJobRepository');
  }

  /**
   * Find print jobs for a restaurant with optional filters.
   *
   * @param restaurantId - Tenant ID
   * @param filters - Optional filters (status, printerId, date range)
   */
  async findByRestaurant(
    restaurantId: Types.ObjectId | string,
    filters?: {
      status?: PrintJobStatus;
      printerId?: Types.ObjectId | string;
      from?: Date;
      to?: Date;
    },
  ): Promise<IPrintJobDocument[]> {
    const query: FilterQuery<IPrintJobDocument> = {};

    if (filters?.status) {
      query.status = filters.status;
    }
    if (filters?.printerId) {
      query.printerId = filters.printerId;
    }
    if (filters?.from || filters?.to) {
      query.createdAt = {};
      if (filters.from) query.createdAt.$gte = filters.from;
      if (filters.to) query.createdAt.$lte = filters.to;
    }

    return this.find(restaurantId, query);
  }

  /**
   * Update a print job's status with optional extra fields.
   *
   * @param restaurantId - Tenant ID
   * @param id - PrintJob ID
   * @param status - New status
   * @param extra - Additional fields to set (e.g., sentAt, lastError, attempts)
   */
  async updateStatus(
    restaurantId: Types.ObjectId | string,
    id: Types.ObjectId | string,
    status: PrintJobStatus,
    extra?: Partial<Pick<IPrintJobDocument, 'sentAt' | 'lastError' | 'attempts'>>,
  ): Promise<IPrintJobDocument | null> {
    const update: UpdateQuery<IPrintJobDocument> = {
      $set: { status, ...extra },
    };
    return this.updateById(restaurantId, id, update);
  }

  /**
   * Find pending print jobs for a specific printer, ordered by creation time.
   */
  async findPendingByPrinter(
    restaurantId: Types.ObjectId | string,
    printerId: Types.ObjectId | string,
  ): Promise<IPrintJobDocument[]> {
    return this.model
      .find({
        restaurantId,
        printerId,
        status: 'pending',
      } as FilterQuery<IPrintJobDocument>)
      .sort({ createdAt: 1 })
      .exec();
  }

  /**
   * Get print job counts grouped by status for a restaurant.
   *
   * @returns Object with status keys and count values
   */
  async getStats(
    restaurantId: Types.ObjectId | string,
  ): Promise<Record<string, number>> {
    const results = await this.model.aggregate<{ _id: string; count: number }>([
      { $match: { restaurantId: typeof restaurantId === 'string' ? new (await import('mongoose')).Types.ObjectId(restaurantId) : restaurantId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const stats: Record<string, number> = {};
    for (const r of results) {
      stats[r._id] = r.count;
    }
    return stats;
  }
}
