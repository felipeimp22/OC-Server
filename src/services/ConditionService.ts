/**
 * @fileoverview Condition Service — evaluates condition nodes in flows.
 *
 * Handles:
 * - Yes/No conditions (field comparison)
 * - Multi-branch conditions (first matching branch)
 * - A/B split (random distribution)
 *
 * @module services/ConditionService
 */

import type { IFlowNode } from '../domain/models/crm/Flow.js';
import type { IContactDocument } from '../domain/models/crm/Contact.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('ConditionService');

/** Result of evaluating a condition node */
export interface ConditionResult {
  /** Which output handle to follow (e.g., "yes", "no", "branch_0", "default") */
  handle: string;
  /** Human-readable explanation */
  reason: string;
}

export class ConditionService {
  /**
   * Evaluate a condition node against a contact and execution context.
   *
   * @param node - The condition node to evaluate
   * @param contact - The CRM contact
   * @param context - The execution context (runtime variables)
   * @returns Which output handle to follow
   */
  evaluate(
    node: IFlowNode,
    contact: IContactDocument,
    context: Record<string, unknown>,
  ): ConditionResult {
    switch (node.subType) {
      case 'yes_no':
        return this.evaluateYesNo(node, contact, context);
      case 'multi_branch':
        return this.evaluateMultiBranch(node, contact, context);
      case 'ab_split':
        return this.evaluateABSplit(node);
      default:
        log.warn({ subType: node.subType }, 'Unknown condition subType');
        return { handle: 'default', reason: `Unknown condition type: ${node.subType}` };
    }
  }

  /**
   * Evaluate a yes/no condition.
   *
   * Config: { field: string, operator: "eq"|"gt"|"lt"|"gte"|"lte"|"contains"|"exists"|"not_exists", value: any }
   */
  private evaluateYesNo(
    node: IFlowNode,
    contact: IContactDocument,
    context: Record<string, unknown>,
  ): ConditionResult {
    const { field, operator, value } = node.config as {
      field: string;
      operator: string;
      value: unknown;
    };

    // Resolve the field value from contact or context
    const actualValue = this.resolveField(field, contact, context);
    const result = this.compare(actualValue, operator, value);

    const handle = result ? 'yes' : 'no';
    const reason = `${field} ${operator} ${JSON.stringify(value)} → ${handle} (actual: ${JSON.stringify(actualValue)})`;

    log.debug({ nodeId: node.id, field, operator, value, actualValue, result }, reason);

    return { handle, reason };
  }

  /**
   * Evaluate a multi-branch condition.
   *
   * Config: { branches: [{ handle: "branch_0", field, operator, value }, ...] }
   */
  private evaluateMultiBranch(
    node: IFlowNode,
    contact: IContactDocument,
    context: Record<string, unknown>,
  ): ConditionResult {
    const branches = (node.config.branches ?? []) as Array<{
      handle: string;
      field: string;
      operator: string;
      value: unknown;
    }>;

    for (const branch of branches) {
      const actualValue = this.resolveField(branch.field, contact, context);
      if (this.compare(actualValue, branch.operator, branch.value)) {
        return {
          handle: branch.handle,
          reason: `Branch ${branch.handle}: ${branch.field} ${branch.operator} ${JSON.stringify(branch.value)}`,
        };
      }
    }

    return { handle: 'default', reason: 'No branch matched — using default' };
  }

  /**
   * Evaluate an A/B split (random distribution).
   *
   * Config: { distribution: [50, 50] } — percentages for each branch
   */
  private evaluateABSplit(node: IFlowNode): ConditionResult {
    const distribution = (node.config.distribution ?? [50, 50]) as number[];
    const random = Math.random() * 100;

    let cumulative = 0;
    for (let i = 0; i < distribution.length; i++) {
      cumulative += distribution[i]!;
      if (random <= cumulative) {
        const handle = `branch_${i}`;
        return {
          handle,
          reason: `A/B split: random ${random.toFixed(1)} → ${handle} (${distribution[i]}%)`,
        };
      }
    }

    return {
      handle: `branch_${distribution.length - 1}`,
      reason: 'A/B split: fallback to last branch',
    };
  }

  /**
   * Resolve a field value from the contact or execution context.
   * Checks contact properties first, then custom fields, then context.
   */
  private resolveField(
    field: string,
    contact: IContactDocument,
    context: Record<string, unknown>,
  ): unknown {
    // Check direct contact properties
    const contactObj = contact.toObject ? contact.toObject() : contact;
    if (field in contactObj) {
      return (contactObj as Record<string, unknown>)[field];
    }

    // Check custom fields
    if (contact.customFields && field in contact.customFields) {
      return contact.customFields[field];
    }

    // Check execution context
    if (field in context) {
      return context[field];
    }

    return undefined;
  }

  /**
   * Compare two values using the given operator.
   */
  private compare(actual: unknown, operator: string, expected: unknown): boolean {
    switch (operator) {
      case 'eq':
        return actual === expected || String(actual) === String(expected);
      case 'neq':
        return actual !== expected && String(actual) !== String(expected);
      case 'gt':
        return Number(actual) > Number(expected);
      case 'gte':
        return Number(actual) >= Number(expected);
      case 'lt':
        return Number(actual) < Number(expected);
      case 'lte':
        return Number(actual) <= Number(expected);
      case 'contains':
        return typeof actual === 'string' && actual.includes(String(expected));
      case 'not_contains':
        return typeof actual === 'string' && !actual.includes(String(expected));
      case 'exists':
        return actual !== undefined && actual !== null;
      case 'not_exists':
        return actual === undefined || actual === null;
      case 'in':
        return Array.isArray(expected) && expected.includes(actual);
      case 'not_in':
        return Array.isArray(expected) && !expected.includes(actual);
      default:
        log.warn({ operator }, 'Unknown comparison operator');
        return false;
    }
  }
}
