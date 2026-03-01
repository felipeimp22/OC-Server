/**
 * @fileoverview CRM Flow repository.
 *
 * Extends BaseRepository with flow-specific queries:
 * - Finding active flows by trigger type (for event processing)
 * - Getting system flows per restaurant (review request)
 * - Stat updates (enrollments, completions)
 *
 * @module repositories/FlowRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { Flow, type IFlowDocument } from '../domain/models/crm/Flow.js';

export class FlowRepository extends BaseRepository<IFlowDocument> {
  constructor() {
    super(Flow, 'FlowRepository');
  }

  /**
   * Find all active flows that have a trigger node matching the given event type.
   * Used by TriggerService to determine which flows should process an incoming event.
   *
   * @param restaurantId - Tenant ID
   * @param triggerSubType - e.g., "order_completed", "customer_created"
   * @returns Active flows with at least one matching trigger node
   */
  async findActiveByTrigger(
    restaurantId: Types.ObjectId | string,
    triggerSubType: string,
  ): Promise<IFlowDocument[]> {
    return this.model.find({
      restaurantId,
      status: 'active',
      'nodes.type': 'trigger',
      'nodes.subType': triggerSubType,
    } as FilterQuery<IFlowDocument>).exec();
  }

  /**
   * Find the system flow for a restaurant (e.g., review request flow).
   *
   * @param restaurantId - Tenant ID
   * @param name - System flow name (optional, defaults to any system flow)
   */
  async findSystemFlow(
    restaurantId: Types.ObjectId | string,
    name?: string,
  ): Promise<IFlowDocument | null> {
    const filter: FilterQuery<IFlowDocument> = { restaurantId, isSystem: true };
    if (name) {
      filter.name = name;
    }
    return this.model.findOne(filter).exec();
  }

  /**
   * Activate a flow (set status to 'active'). Does not touch isSystem flag.
   */
  async activate(id: Types.ObjectId | string): Promise<IFlowDocument | null> {
    return this.model.findByIdAndUpdate(
      id,
      { $set: { status: 'active' } },
      { new: true },
    ).exec();
  }

  /**
   * Pause a flow (set status to 'paused'). Does not touch isSystem flag.
   */
  async pause(id: Types.ObjectId | string): Promise<IFlowDocument | null> {
    return this.model.findByIdAndUpdate(
      id,
      { $set: { status: 'paused' } },
      { new: true },
    ).exec();
  }

  /**
   * Increment enrollment count for a flow (atomic).
   */
  async incrementEnrollments(flowId: Types.ObjectId | string): Promise<void> {
    await this.model.updateOne(
      { _id: flowId },
      { $inc: { 'stats.enrollments': 1, 'stats.activeEnrollments': 1 } },
    ).exec();
  }

  /**
   * Record a completion: decrement active, increment completed (atomic).
   */
  async recordCompletion(flowId: Types.ObjectId | string): Promise<void> {
    await this.model.updateOne(
      { _id: flowId },
      { $inc: { 'stats.completions': 1, 'stats.activeEnrollments': -1 } },
    ).exec();
  }

  /**
   * Decrement active enrollments (for stopped/errored executions).
   */
  async decrementActiveEnrollments(flowId: Types.ObjectId | string): Promise<void> {
    await this.model.updateOne(
      { _id: flowId },
      { $inc: { 'stats.activeEnrollments': -1 } },
    ).exec();
  }

  /**
   * Count active flows for a restaurant.
   */
  async countActive(restaurantId: Types.ObjectId | string): Promise<number> {
    return this.model.countDocuments({ restaurantId, status: 'active' }).exec();
  }

  /**
   * Sum stats.enrollments across all flows for a restaurant.
   */
  async sumEnrollments(restaurantId: Types.ObjectId | string): Promise<number> {
    const result = await this.model.aggregate([
      { $match: { restaurantId } },
      { $group: { _id: null, total: { $sum: '$stats.enrollments' } } },
    ]).exec() as Array<{ total: number }>;
    return result[0]?.total ?? 0;
  }
}
