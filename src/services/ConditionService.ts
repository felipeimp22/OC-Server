/**
 * @fileoverview Condition Service — evaluates yes/no condition nodes in flows.
 *
 * Trigger-bound semantics: the condition node carries no operator config.
 * All filter logic reads from triggerNode.config based on the trigger's subType.
 *
 * @module services/ConditionService
 */

import type { IFlowNode } from '../domain/models/crm/Flow.js';
import type { IContactDocument } from '../domain/models/crm/Contact.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('ConditionService');

/** Result of evaluating a condition node */
export interface ConditionResult {
  /** Which output handle to follow — 'yes' or 'no' for yes_no nodes */
  handle: 'yes' | 'no';
  /** Human-readable explanation */
  reason: string;
}

export class ConditionService {
  /**
   * Evaluate a yes_no condition node against a contact and event context.
   * All filter logic is read from triggerNode.config, not conditionNode.config.
   * Pure synchronous — no async operations.
   *
   * @param conditionNode - The condition node being evaluated
   * @param triggerNode - The flow's trigger node (source of filter config)
   * @param contact - The CRM contact
   * @param eventContext - The execution context (runtime event variables)
   * @returns { handle: 'yes' | 'no', reason: string }
   */
  evaluate(
    conditionNode: IFlowNode,
    triggerNode: IFlowNode,
    contact: IContactDocument,
    eventContext: Record<string, unknown>,
  ): ConditionResult {
    const triggerConfig = (triggerNode.config ?? {}) as Record<string, unknown>;
    const subType = triggerNode.subType;

    log.debug({ subType, conditionNodeId: conditionNode.id }, 'Evaluating condition');

    switch (subType) {
      case 'order_completed':
      case 'first_order': {
        const minOrderTotal = triggerConfig.minOrderTotal as number | undefined;
        if (minOrderTotal !== undefined) {
          const order = eventContext.order as Record<string, unknown> | undefined;
          const orderTotal = (order?.total as number) ?? 0;
          const passes = orderTotal >= minOrderTotal;
          return {
            handle: passes ? 'yes' : 'no',
            reason: `${subType}: order.total(${orderTotal}) >= minOrderTotal(${minOrderTotal}) → ${passes}`,
          };
        }
        return { handle: 'yes', reason: `${subType}: no filter config — always yes` };
      }

      case 'nth_order': {
        const n = triggerConfig.n as number | undefined;
        if (n !== undefined) {
          const passes = contact.totalOrders === n;
          return {
            handle: passes ? 'yes' : 'no',
            reason: `nth_order: totalOrders(${contact.totalOrders}) === n(${n}) → ${passes}`,
          };
        }
        return { handle: 'yes', reason: 'nth_order: no n configured — always yes' };
      }

      case 'order_status_changed': {
        const targetStatus = triggerConfig.targetStatus as string | undefined;
        if (targetStatus !== undefined) {
          const order = eventContext.order as Record<string, unknown> | undefined;
          const currentStatus = order?.status as string | undefined;
          const passes = currentStatus === targetStatus;
          return {
            handle: passes ? 'yes' : 'no',
            reason: `order_status_changed: status(${currentStatus}) === targetStatus(${targetStatus}) → ${passes}`,
          };
        }
        return { handle: 'yes', reason: 'order_status_changed: no targetStatus configured — always yes' };
      }

      case 'no_order_in_x_days': {
        const x = triggerConfig.x as number | undefined;
        if (x !== undefined) {
          const daysSinceOrder = contact.lastOrderAt
            ? Math.floor((Date.now() - contact.lastOrderAt.getTime()) / (1000 * 60 * 60 * 24))
            : Infinity;
          const passes = daysSinceOrder >= x;
          return {
            handle: passes ? 'yes' : 'no',
            reason: `no_order_in_x_days: daysSinceOrder(${daysSinceOrder}) >= x(${x}) → ${passes}`,
          };
        }
        return { handle: 'yes', reason: 'no_order_in_x_days: no x configured — always yes' };
      }

      default:
        return { handle: 'yes', reason: `${subType}: no filter config — always yes` };
    }
  }
}
