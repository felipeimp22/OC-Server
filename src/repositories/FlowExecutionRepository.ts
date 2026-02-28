/**
 * @fileoverview CRM Flow Execution repository.
 *
 * Extends BaseRepository with execution-specific queries:
 * - Finding active executions for a contact in a flow (anti-spam)
 * - Finding executions ready for timer processing
 * - Updating execution state (advance node, complete, stop)
 *
 * @module repositories/FlowExecutionRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { FlowExecution, type IFlowExecutionDocument } from '../domain/models/crm/FlowExecution.js';

export class FlowExecutionRepository extends BaseRepository<IFlowExecutionDocument> {
  constructor() {
    super(FlowExecution, 'FlowExecutionRepository');
  }

  /**
   * Check if a contact is already actively enrolled in a flow.
   * Used by TriggerService for anti-spam checks.
   */
  async isContactEnrolled(
    restaurantId: Types.ObjectId | string,
    flowId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
  ): Promise<boolean> {
    const count = await this.model.countDocuments({
      restaurantId,
      flowId,
      contactId,
      status: 'active',
    } as FilterQuery<IFlowExecutionDocument>).exec();
    return count > 0;
  }

  /**
   * Find all executions for a contact across all flows.
   * Used for the contact activity timeline.
   */
  async findByContact(
    restaurantId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
  ): Promise<IFlowExecutionDocument[]> {
    return this.find(restaurantId, { contactId } as FilterQuery<IFlowExecutionDocument>);
  }

  /**
   * Find executions that are ready for timer processing.
   * These are active executions where nextExecutionAt <= now.
   * Used by FlowTimerProcessor (BullMQ).
   */
  async findReadyForExecution(limit = 100): Promise<IFlowExecutionDocument[]> {
    return this.model.find({
      status: 'active',
      nextExecutionAt: { $lte: new Date() },
    } as FilterQuery<IFlowExecutionDocument>)
      .limit(limit)
      .exec();
  }

  /**
   * Advance execution to the next node.
   *
   * @param id - Execution ID
   * @param nextNodeId - The ID of the next node to process
   * @param contextUpdate - Additional context to merge
   */
  async advanceToNode(
    id: Types.ObjectId | string,
    nextNodeId: string,
    contextUpdate?: Record<string, unknown>,
  ): Promise<IFlowExecutionDocument | null> {
    const update: Record<string, unknown> = {
      currentNodeId: nextNodeId,
      nextExecutionAt: null,
    };

    if (contextUpdate) {
      // Merge new context with existing (using dot notation for nested $set)
      for (const [key, value] of Object.entries(contextUpdate)) {
        update[`context.${key}`] = value;
      }
    }

    return this.model.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
  }

  /**
   * Schedule a timer step: set the nextExecutionAt + keep currentNodeId.
   */
  async scheduleTimer(
    id: Types.ObjectId | string,
    nextExecutionAt: Date,
  ): Promise<IFlowExecutionDocument | null> {
    return this.model.findByIdAndUpdate(
      id,
      { $set: { nextExecutionAt } },
      { new: true },
    ).exec();
  }

  /**
   * Mark execution as completed.
   */
  async markCompleted(id: Types.ObjectId | string): Promise<IFlowExecutionDocument | null> {
    return this.model.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'completed',
          currentNodeId: null,
          completedAt: new Date(),
          nextExecutionAt: null,
        },
      },
      { new: true },
    ).exec();
  }

  /**
   * Mark execution as stopped (manually or by logic.stop node).
   */
  async markStopped(id: Types.ObjectId | string): Promise<IFlowExecutionDocument | null> {
    return this.model.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'stopped',
          currentNodeId: null,
          completedAt: new Date(),
          nextExecutionAt: null,
        },
      },
      { new: true },
    ).exec();
  }

  /**
   * Mark execution as errored, storing metadata in the errorMetadata field.
   */
  async markError(
    id: Types.ObjectId | string,
    metadata?: Record<string, unknown>,
  ): Promise<IFlowExecutionDocument | null> {
    return this.model.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'error',
          completedAt: new Date(),
          nextExecutionAt: null,
          errorMetadata: metadata ?? null,
        },
      },
      { new: true },
    ).exec();
  }

  /**
   * Load a flow execution by ID without restaurantId tenancy check.
   * Used internally by FlowTimerProcessor where restaurantId is not known upfront.
   */
  async findByExecutionId(id: Types.ObjectId | string): Promise<IFlowExecutionDocument | null> {
    return this.model.findById(id).exec();
  }

  /**
   * Count active executions per flow (for flow stats).
   */
  async countActiveByFlow(
    restaurantId: Types.ObjectId | string,
    flowId: Types.ObjectId | string,
  ): Promise<number> {
    return this.model.countDocuments({
      restaurantId,
      flowId,
      status: 'active',
    } as FilterQuery<IFlowExecutionDocument>).exec();
  }
}
