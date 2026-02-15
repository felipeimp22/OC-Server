/**
 * @fileoverview Generic base repository with Mongoose CRUD operations.
 *
 * All repositories extend this class and inherit:
 * - Multi-tenant isolation (restaurantId required on every query)
 * - Paginated listing
 * - Standard CRUD (findById, findOne, find, create, update, delete)
 * - Count queries
 *
 * **IMPORTANT**: Every method that queries data requires `restaurantId` to
 * enforce tenant isolation. This is the primary security boundary.
 *
 * @module repositories/base/BaseRepository
 */

import type { Model, Document, FilterQuery, UpdateQuery, Types } from 'mongoose';
import type { IPaginationOptions, IPaginatedResult } from '../../domain/interfaces/IRepository.js';
import { createLogger } from '../../config/logger.js';

/**
 * Generic base repository providing standard CRUD operations.
 *
 * @typeParam T - The Mongoose document interface
 *
 * @example
 * ```ts
 * class ContactRepository extends BaseRepository<IContactDocument> {
 *   constructor() {
 *     super(Contact, 'ContactRepository');
 *   }
 * }
 * ```
 */
export class BaseRepository<T extends Document> {
  protected readonly model: Model<T>;
  protected readonly log: ReturnType<typeof createLogger>;

  constructor(model: Model<T>, name: string) {
    this.model = model;
    this.log = createLogger(name);
  }

  /**
   * Find a single document by ID within a restaurant.
   *
   * @param restaurantId - Tenant ID for isolation
   * @param id - Document ObjectId
   * @returns The document or null if not found
   */
  async findById(restaurantId: Types.ObjectId | string, id: Types.ObjectId | string): Promise<T | null> {
    return this.model.findOne({ _id: id, restaurantId } as FilterQuery<T>).exec();
  }

  /**
   * Find a single document matching a filter within a restaurant.
   *
   * @param restaurantId - Tenant ID for isolation
   * @param filter - Additional query conditions (restaurantId is auto-added)
   * @returns The first matching document or null
   */
  async findOne(restaurantId: Types.ObjectId | string, filter: FilterQuery<T>): Promise<T | null> {
    return this.model.findOne({ ...filter, restaurantId } as FilterQuery<T>).exec();
  }

  /**
   * Find all documents matching a filter within a restaurant.
   *
   * @param restaurantId - Tenant ID for isolation
   * @param filter - Additional query conditions (restaurantId is auto-added)
   * @returns Array of matching documents
   */
  async find(restaurantId: Types.ObjectId | string, filter: FilterQuery<T> = {}): Promise<T[]> {
    return this.model.find({ ...filter, restaurantId } as FilterQuery<T>).exec();
  }

  /**
   * Find documents with pagination.
   *
   * @param restaurantId - Tenant ID for isolation
   * @param filter - Additional query conditions
   * @param options - Pagination options (page, limit, sortBy, sortOrder)
   * @returns Paginated result with data, total count, and page info
   */
  async findPaginated(
    restaurantId: Types.ObjectId | string,
    filter: FilterQuery<T> = {},
    options: IPaginationOptions = {},
  ): Promise<IPaginatedResult<T>> {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = options;
    const skip = (page - 1) * limit;
    const query = { ...filter, restaurantId } as FilterQuery<T>;

    const [data, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    };
  }

  /**
   * Create a new document.
   *
   * @param data - Document data (must include restaurantId)
   * @returns The created document
   */
  async create(data: Partial<T>): Promise<T> {
    const doc = new this.model(data);
    return doc.save() as Promise<T>;
  }

  /**
   * Update a document by ID within a restaurant.
   *
   * @param restaurantId - Tenant ID for isolation
   * @param id - Document ObjectId
   * @param update - Fields to update
   * @returns The updated document or null if not found
   */
  async updateById(
    restaurantId: Types.ObjectId | string,
    id: Types.ObjectId | string,
    update: UpdateQuery<T>,
  ): Promise<T | null> {
    return this.model
      .findOneAndUpdate({ _id: id, restaurantId } as FilterQuery<T>, update, { new: true })
      .exec();
  }

  /**
   * Update the first document matching a filter within a restaurant.
   *
   * @param restaurantId - Tenant ID for isolation
   * @param filter - Query conditions
   * @param update - Fields to update
   * @returns The updated document or null
   */
  async updateOne(
    restaurantId: Types.ObjectId | string,
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
  ): Promise<T | null> {
    return this.model
      .findOneAndUpdate({ ...filter, restaurantId } as FilterQuery<T>, update, { new: true })
      .exec();
  }

  /**
   * Delete a document by ID within a restaurant.
   *
   * @param restaurantId - Tenant ID for isolation
   * @param id - Document ObjectId
   * @returns true if the document was deleted, false if not found
   */
  async deleteById(restaurantId: Types.ObjectId | string, id: Types.ObjectId | string): Promise<boolean> {
    const result = await this.model.deleteOne({ _id: id, restaurantId } as FilterQuery<T>).exec();
    return result.deletedCount > 0;
  }

  /**
   * Count documents matching a filter within a restaurant.
   *
   * @param restaurantId - Tenant ID for isolation
   * @param filter - Additional query conditions
   * @returns The count of matching documents
   */
  async count(restaurantId: Types.ObjectId | string, filter: FilterQuery<T> = {}): Promise<number> {
    return this.model.countDocuments({ ...filter, restaurantId } as FilterQuery<T>).exec();
  }
}
