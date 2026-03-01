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
import { FlowEngineService } from './FlowEngineService.js';
import type { IFlowDocument, IFlowNode } from '../domain/models/crm/Flow.js';
import type { IFlowExecutionDocument } from '../domain/models/crm/FlowExecution.js';
import type { ICRMEventPayload } from '../domain/interfaces/IEvent.js';
import { Order } from '../domain/models/external/Order.js';
import mongoose from 'mongoose';
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
    log.debug({ restaurantId, eventType, flowsFound: flows.length }, 'Active flows found for trigger');
    if (flows.length === 0) {
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

    log.info({ flowId, flowName: flow.name, contactId, eventType }, 'Evaluating flow for contact');

    // Find the matching trigger node
    const triggerNode = flow.nodes.find(
      (n) => n.type === 'trigger' && n.subType === eventType,
    );
    if (!triggerNode) {
      log.info({ flowId, eventType, nodeTypes: flow.nodes.map(n => `${n.type}:${n.subType}`) }, 'No matching trigger node found');
      return { flowId, flowName: flow.name, enrolled: false, reason: 'No matching trigger node' };
    }

    // Check trigger conditions (e.g., orderTypes filter)
    if (!(await this.checkTriggerConditions(triggerNode, payload))) {
      log.info({ flowId, contactId, config: triggerNode.config, payloadStatus: payload.paymentStatus ?? payload.newStatus }, 'Trigger conditions not met');
      return { flowId, flowName: flow.name, enrolled: false, reason: 'Trigger conditions not met' };
    }

    // Order-level dedup: for order-based triggers, check if this order was already processed for this flow
    if ((eventType === 'order_completed' || eventType === 'new_order' || eventType === 'item_ordered' || eventType === 'item_ordered_x_times') && payload.orderId) {
      const alreadyProcessed = await this.executionRepo.hasOrderBeenProcessedForFlow(
        restaurantId,
        flowId,
        payload.orderId as string,
      );
      if (alreadyProcessed) {
        log.info({ flowId, contactId, orderId: payload.orderId }, 'Order already processed for this flow — skipping');
        return { flowId, flowName: flow.name, enrolled: false, reason: 'Order already processed for this flow' };
      }
    }

    // Anti-spam: check if already enrolled
    const isEnrolled = await this.executionRepo.isContactEnrolled(restaurantId, flowId, contactId);
    if (isEnrolled) {
      log.info({ flowId, contactId }, 'Contact already enrolled — skipping');
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
   * Normalize payment status values between different naming conventions.
   * Stripe uses 'succeeded', but UIs often configure 'paid'.
   */
  private normalizePaymentStatus(status: string): string {
    const mapping: Record<string, string> = {
      succeeded: 'paid',
      paid: 'paid',
      failed: 'failed',
      pending: 'pending',
      refunded: 'refunded',
    };
    return mapping[status.toLowerCase()] ?? status.toLowerCase();
  }

  /**
   * Check if the event payload matches the trigger node's conditions.
   */
  private async checkTriggerConditions(triggerNode: IFlowNode, payload: ICRMEventPayload): Promise<boolean> {
    const config = triggerNode.config;

    // Resolve effective payment status from multiple possible payload fields
    const rawPaymentStatus = payload.paymentStatus ?? payload.newStatus ?? (payload as any).status;

    log.info(
      { config, orderType: payload.orderType, rawPaymentStatus, orderTotal: payload.orderTotal },
      'Checking trigger conditions',
    );

    // Check orderTypes filter
    if (config.orderTypes && Array.isArray(config.orderTypes) && config.orderTypes.length > 0) {
      if (payload.orderType && !config.orderTypes.includes(payload.orderType)) {
        log.info({ expected: config.orderTypes, got: payload.orderType }, 'orderType mismatch');
        return false;
      }
      // If orderTypes is configured but payload has none, allow through (don't block)
    }

    // Check minimum order total
    if (config.minOrderTotal && typeof config.minOrderTotal === 'number' && payload.orderTotal) {
      if (payload.orderTotal < config.minOrderTotal) {
        log.info({ minRequired: config.minOrderTotal, got: payload.orderTotal }, 'minOrderTotal not met');
        return false;
      }
    }

    // Check paymentStatus filter (e.g. first_order trigger configured for 'paid' only)
    if (config.paymentStatus && rawPaymentStatus) {
      const normalizedConfig = this.normalizePaymentStatus(String(config.paymentStatus));
      const normalizedPayload = this.normalizePaymentStatus(String(rawPaymentStatus));
      if (normalizedConfig !== normalizedPayload) {
        log.info(
          { configStatus: config.paymentStatus, payloadStatus: rawPaymentStatus, normalizedConfig, normalizedPayload },
          'paymentStatus mismatch after normalization',
        );
        return false;
      }
    }

    // nth_order: fire exactly once when contact's totalOrders reaches config.n.
    // nth_order depends on contact.totalOrders being incremented in
    // processOrderAsCompleted() BEFORE this evaluation. Count includes current order.
    if (triggerNode.subType === 'nth_order') {
      const n = config.n as number | undefined;
      const totalOrders = payload.totalOrders as number | undefined;
      if (n == null || totalOrders == null || totalOrders !== n) {
        log.info({ n, totalOrders, reason: 'nth_order threshold not met (requires exact match)' }, 'nth_order check failed');
        return false;
      }
    }

    // item_ordered: match order items against configured menu items with optional modifier filtering.
    // Uses payload.items (fetched from DB in OrderEventConsumer.processOrderAsCompleted()).
    if (triggerNode.subType === 'item_ordered') {
      const configItems = config.items as Array<{ menuItemId: string; menuItemName: string; modifiers?: Array<{ optionName: string; choiceNames: string[] }> }> | undefined;
      const matchMode = (config.matchMode as string) ?? 'any';
      const orderItems = payload.items as Array<{ menuItemId: string; name: string; options?: Array<{ name: string; choice: string }> }> | undefined;

      if (!configItems || configItems.length === 0 || !orderItems || orderItems.length === 0) {
        log.info({ reason: 'item_ordered: empty config.items or payload.items' }, 'item_ordered check failed');
        return false;
      }

      const itemMatches = configItems.map((configItem) => {
        // Find order item with matching menuItemId (string comparison)
        const matchingOrderItem = orderItems.find(
          (oi) => String(oi.menuItemId) === String(configItem.menuItemId),
        );
        if (!matchingOrderItem) return false;

        // If config has modifiers, ALL specified modifiers must match
        if (configItem.modifiers && configItem.modifiers.length > 0) {
          const orderOptions = matchingOrderItem.options ?? [];
          return configItem.modifiers.every((modifier) => {
            // Find an order option matching the modifier's option name
            return orderOptions.some(
              (opt) =>
                opt.name === modifier.optionName &&
                modifier.choiceNames.includes(opt.choice),
            );
          });
        }

        // No modifiers specified — menuItemId match is sufficient
        return true;
      });

      const passes = matchMode === 'all'
        ? itemMatches.every(Boolean)
        : itemMatches.some(Boolean);

      if (!passes) {
        log.info({ matchMode, itemMatches, reason: 'item_ordered: item match failed' }, 'item_ordered check failed');
        return false;
      }
    }

    // item_ordered_x_times: cumulative counting — fire exactly at threshold.
    // First checks current order contains matching items (same logic as item_ordered),
    // then queries DB for lifetime count. Uses === for exact threshold match.
    if (triggerNode.subType === 'item_ordered_x_times') {
      const configItems = config.items as Array<{ menuItemId: string; menuItemName: string; modifiers?: Array<{ optionName: string; choiceNames: string[] }> }> | undefined;
      const matchMode = (config.matchMode as string) ?? 'any';
      const threshold = config.threshold as number | undefined;
      const orderItems = payload.items as Array<{ menuItemId: string; name: string; options?: Array<{ name: string; choice: string }> }> | undefined;

      if (!configItems || configItems.length === 0 || !orderItems || orderItems.length === 0) {
        log.info({ reason: 'item_ordered_x_times: empty config.items or payload.items' }, 'item_ordered_x_times check failed');
        return false;
      }
      if (!threshold || threshold < 1) {
        log.info({ threshold, reason: 'item_ordered_x_times: invalid threshold' }, 'item_ordered_x_times check failed');
        return false;
      }

      // Early return: check if current order contains any matching config items
      const currentOrderMatches = configItems.map((configItem) => {
        const matchingOrderItem = orderItems.find(
          (oi) => String(oi.menuItemId) === String(configItem.menuItemId),
        );
        if (!matchingOrderItem) return false;

        if (configItem.modifiers && configItem.modifiers.length > 0) {
          const orderOptions = matchingOrderItem.options ?? [];
          return configItem.modifiers.every((modifier) => {
            return orderOptions.some(
              (opt) =>
                opt.name === modifier.optionName &&
                modifier.choiceNames.includes(opt.choice),
            );
          });
        }
        return true;
      });

      const hasAnyCurrentMatch = currentOrderMatches.some(Boolean);
      if (!hasAnyCurrentMatch) {
        log.info({ reason: 'item_ordered_x_times: no matching items in current order' }, 'item_ordered_x_times check failed');
        return false;
      }

      // Count lifetime orders containing each matching config item.
      // The current order is already saved to DB by the time triggers evaluate.
      const restaurantId = payload.restaurantId as string | undefined;
      const customerId = payload.customerId as string | undefined;
      if (!restaurantId || !customerId) {
        log.info({ reason: 'item_ordered_x_times: missing restaurantId or customerId' }, 'item_ordered_x_times check failed');
        return false;
      }

      const thresholdResults = await Promise.all(
        configItems.map(async (configItem, idx) => {
          if (!currentOrderMatches[idx]) return false; // Skip items not in current order
          const count = await this.countItemOrdersByCustomer(
            restaurantId,
            customerId,
            configItem.menuItemId,
            configItem.modifiers,
          );
          log.info(
            { menuItemId: configItem.menuItemId, count, threshold },
            'item_ordered_x_times: lifetime count for item',
          );
          return count === threshold;
        }),
      );

      const passes = matchMode === 'all'
        ? thresholdResults.every(Boolean)
        : thresholdResults.some(Boolean);

      if (!passes) {
        log.info({ matchMode, thresholdResults, reason: 'item_ordered_x_times: threshold not met' }, 'item_ordered_x_times check failed');
        return false;
      }
    }

    // Target status filtering — generic check for any trigger with config.targetStatuses.
    // Backward compat: convert legacy single-string config.targetStatus to array format.
    let effectiveTargetStatuses = config.targetStatuses as string[] | undefined;
    if (
      (!effectiveTargetStatuses || !Array.isArray(effectiveTargetStatuses) || effectiveTargetStatuses.length === 0) &&
      config.targetStatus &&
      typeof config.targetStatus === 'string' &&
      config.targetStatus !== ''
    ) {
      effectiveTargetStatuses = [config.targetStatus];
    }

    if (effectiveTargetStatuses && Array.isArray(effectiveTargetStatuses) && effectiveTargetStatuses.length > 0) {
      const actualStatus = (payload.newStatus ?? (payload as any).status) as string | undefined;
      if (actualStatus && !effectiveTargetStatuses.includes(actualStatus)) {
        log.info(
          { configuredStatuses: effectiveTargetStatuses, actualStatus, reason: 'targetStatuses mismatch' },
          'targetStatuses mismatch',
        );
        return false;
      }
    }

    log.info('All trigger conditions passed');
    return true;
  }

  /**
   * Count the number of paid orders containing a specific menu item for a customer.
   * Uses MongoDB aggregation: $match by restaurant+customer+paid, $unwind items,
   * $match by menuItemId (and optional modifier filter), $count.
   *
   * The count includes the current order since the order is already saved to DB
   * by the time triggers evaluate in processOrderAsCompleted().
   */
  private async countItemOrdersByCustomer(
    restaurantId: string,
    customerId: string,
    menuItemId: string,
    modifiers?: Array<{ optionName: string; choiceNames: string[] }>,
  ): Promise<number> {
    const pipeline: any[] = [
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          customerId: new mongoose.Types.ObjectId(customerId),
          paymentStatus: 'paid',
        },
      },
      { $unwind: '$items' },
      {
        $match: {
          'items.menuItemId': new mongoose.Types.ObjectId(menuItemId),
        },
      },
    ];

    // If modifiers are specified, add a $match stage for each modifier requirement
    if (modifiers && modifiers.length > 0) {
      for (const modifier of modifiers) {
        pipeline.push({
          $match: {
            'items.options': {
              $elemMatch: {
                name: modifier.optionName,
                choice: { $in: modifier.choiceNames },
              },
            },
          },
        });
      }
    }

    pipeline.push({ $count: 'total' });

    const result = await Order.aggregate(pipeline).exec();
    return result.length > 0 ? result[0].total : 0;
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

    // Kick off processing of the first action node
    if (firstNodeId) {
      try {
        const flowEngine = new FlowEngineService();
        await flowEngine.processCurrentNode(execution._id.toString());
      } catch (err) {
        log.error(
          { err, executionId: execution._id.toString(), firstNodeId },
          'Failed to process first node — marking execution as error',
        );
        await this.executionRepo.markError(execution._id.toString(), {
          error: (err as Error).message,
          failedNodeId: firstNodeId,
        });
      }
    }

    return execution;
  }
}
