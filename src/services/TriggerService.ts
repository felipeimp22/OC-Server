/**
 * @fileoverview Trigger Service — evaluates if a contact should enter a flow.
 *
 * When an event arrives (e.g., order.completed), TriggerService:
 * 1. Finds all active flows with matching trigger nodes
 * 2. Evaluates trigger conditions against the event/contact data
 * 3. Checks anti-spam (is contact already enrolled?)
 * 4. Creates FlowExecution records for qualifying contacts
 *
 * @module services/TriggerService
 */

import { FlowService } from './FlowService.js';
import { FlowExecutionRepository } from '../repositories/FlowExecutionRepository.js';
import { FlowExecutionLogRepository } from '../repositories/FlowExecutionLogRepository.js';
import type { IFlowDocument, IFlowNode } from '../domain/models/crm/Flow.js';
import type { IFlowExecutionDocument } from '../domain/models/crm/FlowExecution.js';
import type { ICRMEventPayload } from '../domain/interfaces/IEvent.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('TriggerService');

export interface TriggerEvaluationResult {
  flowId: string;
  flowName: string;
  enrolled: boolean;
  executionId?: string;
  reason?: string;
}

export class TriggerService {
  private readonly flowService: FlowService;
  private readonly executionRepo: FlowExecutionRepository;
  private readonly logRepo: FlowExecutionLogRepository;

  constructor() {
    this.flowService = new FlowService();
    this.executionRepo = new FlowExecutionRepository();
    this.logRepo = new FlowExecutionLogRepository();
  }

  /**
   * Evaluate all active flows for a given event and enroll the contact
   * in qualifying flows.
   *
   * @param restaurantId - Tenant ID
   * @param eventType - e.g., "order_completed"
   * @param contactId - CRM contact ID
   * @param payload - Event payload data
   * @returns Array of evaluation results (one per matching flow)
   */
  async evaluateTriggers(
    restaurantId: string,
    eventType: string,
    contactId: string,
    payload: ICRMEventPayload,
  ): Promise<TriggerEvaluationResult[]> {
    // Find all active flows with this trigger type
    const flows = await this.flowService.findActiveByTrigger(restaurantId, eventType);
    if (flows.length === 0) {
      log.debug({ restaurantId, eventType }, 'No active flows for trigger type');
      return [];
    }

    const results: TriggerEvaluationResult[] = [];

    for (const flow of flows) {
      const result = await this.evaluateSingleFlow(restaurantId, flow, contactId, eventType, payload);
      results.push(result);
    }

    return results;
  }

  /**
   * Evaluate a single flow's trigger against a contact/event.
   */
  private async evaluateSingleFlow(
    restaurantId: string,
    flow: IFlowDocument,
    contactId: string,
    eventType: string,
    payload: ICRMEventPayload,
  ): Promise<TriggerEvaluationResult> {
    const flowId = flow._id.toString();

    // Find the matching trigger node
    const triggerNode = flow.nodes.find(
      (n) => n.type === 'trigger' && n.subType === eventType,
    );
    if (!triggerNode) {
      return { flowId, flowName: flow.name, enrolled: false, reason: 'No matching trigger node' };
    }

    // Check trigger conditions (e.g., orderTypes filter)
    if (!this.checkTriggerConditions(triggerNode, payload)) {
      return { flowId, flowName: flow.name, enrolled: false, reason: 'Trigger conditions not met' };
    }

    // Anti-spam: check if already enrolled
    const isEnrolled = await this.executionRepo.isContactEnrolled(restaurantId, flowId, contactId);
    if (isEnrolled) {
      return { flowId, flowName: flow.name, enrolled: false, reason: 'Contact already enrolled' };
    }

    // Create execution record
    const execution = await this.enrollContact(restaurantId, flow, contactId, triggerNode, payload);

    log.info(
      { restaurantId, flowId, contactId, executionId: execution._id.toString() },
      'Contact enrolled in flow',
    );

    return {
      flowId,
      flowName: flow.name,
      enrolled: true,
      executionId: execution._id.toString(),
    };
  }

  /**
   * Check if the event payload matches the trigger node's conditions.
   */
  private checkTriggerConditions(triggerNode: IFlowNode, payload: ICRMEventPayload): boolean {
    const config = triggerNode.config;

    // Check orderTypes filter
    if (config.orderTypes && Array.isArray(config.orderTypes) && payload.orderType) {
      if (!config.orderTypes.includes(payload.orderType)) {
        return false;
      }
    }

    // Check minimum order value
    if (config.minOrderValue && typeof config.minOrderValue === 'number' && payload.orderTotal) {
      if (payload.orderTotal < config.minOrderValue) {
        return false;
      }
    }

    return true;
  }

  /**
   * Enroll a contact in a flow by creating a FlowExecution record.
   */
  private async enrollContact(
    restaurantId: string,
    flow: IFlowDocument,
    contactId: string,
    triggerNode: IFlowNode,
    payload: ICRMEventPayload,
  ): Promise<IFlowExecutionDocument> {
    // Find the first node after the trigger (via edges)
    const firstEdge = flow.edges.find((e) => e.sourceNodeId === triggerNode.id);
    const firstNodeId = firstEdge?.targetNodeId ?? null;

    const execution = await this.executionRepo.create({
      flowId: flow._id,
      restaurantId,
      contactId,
      status: 'active',
      currentNodeId: firstNodeId,
      startedAt: new Date(),
      context: { ...payload },
    } as any);

    // Update flow stats
    await this.flowService.incrementEnrollments(flow._id.toString());

    // Log the trigger
    await this.logRepo.create({
      executionId: execution._id,
      flowId: flow._id,
      restaurantId,
      contactId,
      nodeId: triggerNode.id,
      nodeType: 'trigger',
      action: `Trigger fired: ${triggerNode.subType}`,
      result: 'success',
      metadata: { payload },
      executedAt: new Date(),
    } as any);

    return execution;
  }
}
