/**
 * @fileoverview CRM Flow Execution Log repository.
 *
 * Extends BaseRepository with log-specific queries for:
 * - Contact activity timeline
 * - Per-node analytics (success/failure rates)
 * - Execution trace (all steps for one execution)
 *
 * @module repositories/FlowExecutionLogRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { FlowExecutionLog, type IFlowExecutionLogDocument } from '../domain/models/crm/FlowExecutionLog.js';

export class FlowExecutionLogRepository extends BaseRepository<IFlowExecutionLogDocument> {
  constructor() {
    super(FlowExecutionLog, 'FlowExecutionLogRepository');
  }

  /**
   * Get all log entries for a specific execution.
   * Ordered by executedAt ascending (chronological).
   */
  async findByExecution(executionId: Types.ObjectId | string): Promise<IFlowExecutionLogDocument[]> {
    return this.model.find({ executionId })
      .sort({ executedAt: 1 })
      .exec();
  }

  /**
   * Get contact activity timeline (most recent first).
   */
  async findByContact(
    restaurantId: Types.ObjectId | string,
    contactId: Types.ObjectId | string,
    limit = 50,
  ): Promise<IFlowExecutionLogDocument[]> {
    return this.model.find({ restaurantId, contactId } as FilterQuery<IFlowExecutionLogDocument>)
      .sort({ executedAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Get step-level analytics for a flow: count of success/failure/skipped per node.
   * Used for the flow analytics dashboard.
   */
  async getNodeStats(
    flowId: Types.ObjectId | string,
  ): Promise<Array<{ nodeId: string; nodeType: string; success: number; failure: number; skipped: number; total: number }>> {
    const results = await this.model.aggregate([
      { $match: { flowId: typeof flowId === 'string' ? new this.model.base.Types.ObjectId(flowId) : flowId } },
      {
        $group: {
          _id: { nodeId: '$nodeId', nodeType: '$nodeType' },
          success: { $sum: { $cond: [{ $eq: ['$result', 'success'] }, 1, 0] } },
          failure: { $sum: { $cond: [{ $eq: ['$result', 'failure'] }, 1, 0] } },
          skipped: { $sum: { $cond: [{ $eq: ['$result', 'skipped'] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          nodeId: '$_id.nodeId',
          nodeType: '$_id.nodeType',
          success: 1,
          failure: 1,
          skipped: 1,
          total: 1,
        },
      },
    ]).exec();

    return results;
  }
}
