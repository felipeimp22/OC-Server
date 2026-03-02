/**
 * @fileoverview Flow Service — CRUD operations for automation flows.
 *
 * Handles:
 * - Flow creation, update, deletion
 * - Flow activation and pausing
 * - System flow management
 * - Flow template creation
 *
 * @module services/FlowService
 */

import { FlowRepository } from '../repositories/FlowRepository.js';
import type { IFlowDocument } from '../domain/models/crm/Flow.js';
import type { IPaginationOptions, IPaginatedResult } from '../domain/interfaces/IRepository.js';
import { createLogger } from '../config/logger.js';
import { validateFlowGraph, FlowValidationError } from '../lib/flowValidation.js';

export { FlowValidationError };

const log = createLogger('FlowService');

export class FlowService {
  private readonly flowRepo: FlowRepository;

  constructor() {
    this.flowRepo = new FlowRepository();
  }

  /**
   * Create a new flow.
   */
  async create(
    restaurantId: string,
    data: {
      name: string;
      description?: string;
      nodes?: IFlowDocument['nodes'];
      edges?: IFlowDocument['edges'];
      isSystem?: boolean;
    },
  ): Promise<IFlowDocument> {
    const flow = await this.flowRepo.create({
      restaurantId,
      name: data.name,
      description: data.description ?? null,
      status: 'draft',
      isSystem: data.isSystem ?? false,
      version: 1,
      nodes: data.nodes ?? [],
      edges: data.edges ?? [],
    } as any);

    log.info({ restaurantId, flowId: flow._id, name: flow.name }, 'Flow created');
    return flow;
  }

  /**
   * Get a flow by ID.
   */
  async getById(restaurantId: string, flowId: string): Promise<IFlowDocument | null> {
    return this.flowRepo.findById(restaurantId, flowId);
  }

  /**
   * List flows with pagination.
   */
  async list(
    restaurantId: string,
    filters: Record<string, unknown> = {},
    pagination?: IPaginationOptions,
  ): Promise<IPaginatedResult<IFlowDocument>> {
    return this.flowRepo.findPaginated(restaurantId, filters, pagination);
  }

  /**
   * Update a flow's definition (nodes, edges, name, description).
   * Only allowed when flow is in draft or paused status.
   */
  async update(
    restaurantId: string,
    flowId: string,
    data: Partial<Pick<IFlowDocument, 'name' | 'description' | 'nodes' | 'edges'>>,
  ): Promise<IFlowDocument | null> {
    const flow = await this.flowRepo.findById(restaurantId, flowId);
    if (!flow) return null;

    if (flow.status === 'active') {
      throw new Error('Cannot update an active flow. Pause it first.');
    }

    const updated = await this.flowRepo.updateById(restaurantId, flowId, {
      $set: data,
      $inc: { version: 1 },
    });

    if (updated) {
      log.info({ restaurantId, flowId, version: updated.version }, 'Flow updated');
    }
    return updated;
  }

  /**
   * Activate a flow (start processing events).
   */
  async activate(restaurantId: string, flowId: string): Promise<IFlowDocument | null> {
    const flow = await this.flowRepo.findById(restaurantId, flowId);
    if (!flow) return null;

    if (flow.status === 'active') return flow;
    if (flow.status === 'archived') {
      throw new Error('Cannot activate an archived flow');
    }

    // Validate graph structure
    const validation = validateFlowGraph(flow.nodes, flow.edges ?? []);
    if (!validation.valid) {
      throw new FlowValidationError(validation.rule, validation.message);
    }

    // Set activatedAt only on first activation — preserve original date across pause/reactivate
    const setFields: Record<string, unknown> = { status: 'active' };
    if (!flow.activatedAt) {
      setFields.activatedAt = new Date();
    }

    const updated = await this.flowRepo.updateById(restaurantId, flowId, {
      $set: setFields,
    });

    if (updated) {
      log.info({ restaurantId, flowId }, 'Flow activated');
    }
    return updated;
  }

  /**
   * Pause a flow (stop processing new events, existing enrollments continue).
   */
  async pause(restaurantId: string, flowId: string): Promise<IFlowDocument | null> {
    const updated = await this.flowRepo.updateById(restaurantId, flowId, {
      $set: { status: 'paused' },
    });

    if (updated) {
      log.info({ restaurantId, flowId }, 'Flow paused');
    }
    return updated;
  }

  /**
   * Delete a flow. System flows cannot be deleted.
   */
  async delete(restaurantId: string, flowId: string): Promise<boolean> {
    const flow = await this.flowRepo.findById(restaurantId, flowId);
    if (!flow) return false;

    if (flow.isSystem) {
      throw new Error('System flows cannot be deleted');
    }

    const deleted = await this.flowRepo.deleteById(restaurantId, flowId);
    if (deleted) {
      log.info({ restaurantId, flowId }, 'Flow deleted');
    }
    return deleted;
  }

  /**
   * Find all active flows with a specific trigger type.
   * Used by TriggerService during event processing.
   */
  async findActiveByTrigger(
    restaurantId: string,
    triggerSubType: string,
  ): Promise<IFlowDocument[]> {
    return this.flowRepo.findActiveByTrigger(restaurantId, triggerSubType);
  }

  /**
   * Get or ensure the system flow exists for a restaurant.
   */
  async getSystemFlow(restaurantId: string): Promise<IFlowDocument | null> {
    return this.flowRepo.findSystemFlow(restaurantId);
  }

  /**
   * Increment enrollment count.
   */
  async incrementEnrollments(flowId: string): Promise<void> {
    await this.flowRepo.incrementEnrollments(flowId);
  }

  /**
   * Record completion.
   */
  async recordCompletion(flowId: string): Promise<void> {
    await this.flowRepo.recordCompletion(flowId);
  }
}
