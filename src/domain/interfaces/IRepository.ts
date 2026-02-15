/**
 * @fileoverview Generic repository interface.
 * All CRM repositories implement this interface, ensuring consistent
 * data access patterns and mandatory multi-tenant isolation via restaurantId.
 *
 * @module domain/interfaces/IRepository
 */

import type { Types, FilterQuery, SortOrder } from 'mongoose';

/**
 * Pagination options for list queries.
 */
export interface IPaginationOptions {
  /** Page number (1-indexed, defaults to 1) */
  page?: number;
  /** Number of items per page (defaults to 20) */
  limit?: number;
  /** Sort field name */
  sortBy?: string;
  /** Sort direction */
  sortOrder?: SortOrder;
}

/**
 * Paginated result wrapper.
 */
export interface IPaginatedResult<T> {
  /** Array of items for the current page */
  data: T[];
  /** Total number of matching items (across all pages) */
  total: number;
  /** Current page number */
  page: number;
  /** Items per page */
  limit: number;
  /** Total number of pages */
  totalPages: number;
  /** Whether more pages exist after the current one */
  hasMore: boolean;
}

/**
 * Generic repository interface for CRM-owned collections.
 * Every method requires `restaurantId` to enforce multi-tenant isolation.
 *
 * @typeParam T - The Mongoose document type
 * @typeParam TCreate - The input type for creating a new document
 * @typeParam TUpdate - The input type for updating an existing document
 */
export interface IRepository<T, TCreate = Partial<T>, TUpdate = Partial<T>> {
  /**
   * Find a document by ID within a restaurant scope.
   *
   * @param restaurantId - Restaurant scope for tenant isolation
   * @param id - Document ObjectId
   * @returns The document or null if not found
   */
  findById(restaurantId: Types.ObjectId, id: Types.ObjectId): Promise<T | null>;

  /**
   * Find a single document matching a filter within a restaurant scope.
   *
   * @param restaurantId - Restaurant scope for tenant isolation
   * @param filter - Mongoose filter query (restaurantId is automatically included)
   * @returns The document or null if not found
   */
  findOne(restaurantId: Types.ObjectId, filter: FilterQuery<T>): Promise<T | null>;

  /**
   * Find multiple documents with pagination within a restaurant scope.
   *
   * @param restaurantId - Restaurant scope for tenant isolation
   * @param filter - Mongoose filter query
   * @param options - Pagination and sort options
   * @returns Paginated result
   */
  findMany(
    restaurantId: Types.ObjectId,
    filter: FilterQuery<T>,
    options: IPaginationOptions,
  ): Promise<IPaginatedResult<T>>;

  /**
   * Create a new document within a restaurant scope.
   *
   * @param restaurantId - Restaurant scope for tenant isolation
   * @param data - Document data (restaurantId is automatically set)
   * @returns The created document
   */
  create(restaurantId: Types.ObjectId, data: TCreate): Promise<T>;

  /**
   * Update a document by ID within a restaurant scope.
   *
   * @param restaurantId - Restaurant scope for tenant isolation
   * @param id - Document ObjectId
   * @param data - Fields to update
   * @returns The updated document or null if not found
   */
  updateById(restaurantId: Types.ObjectId, id: Types.ObjectId, data: TUpdate): Promise<T | null>;

  /**
   * Delete a document by ID within a restaurant scope.
   *
   * @param restaurantId - Restaurant scope for tenant isolation
   * @param id - Document ObjectId
   * @returns True if the document was deleted, false if not found
   */
  deleteById(restaurantId: Types.ObjectId, id: Types.ObjectId): Promise<boolean>;

  /**
   * Count documents matching a filter within a restaurant scope.
   *
   * @param restaurantId - Restaurant scope for tenant isolation
   * @param filter - Mongoose filter query
   * @returns Count of matching documents
   */
  count(restaurantId: Types.ObjectId, filter?: FilterQuery<T>): Promise<number>;
}
