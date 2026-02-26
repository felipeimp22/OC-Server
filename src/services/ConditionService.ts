/**
 * @fileoverview Condition Service — evaluates condition nodes in flows.
 *
 * Handles yes_no condition evaluation with AND/OR operator joining.
 * Unsupported subtypes (ab_split, multi_branch, random_distribution) default to 'yes'.
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

interface SingleCondition {
  field: string;
  operator: string;
  value: unknown;
}

export class ConditionService {
  /**
   * Evaluate a condition node against a contact and execution context.
   * Pure synchronous — no async operations.
   *
   * @param node - The condition node to evaluate
   * @param contact - The CRM contact
   * @param context - The execution context (runtime variables)
   * @returns { handle: 'yes' | 'no', reason: string }
   */
  evaluate(
    node: IFlowNode,
    contact: IContactDocument,
    context: Record<string, unknown>,
  ): ConditionResult {
    switch (node.subType) {
      case 'yes_no':
        return this.evaluateYesNo(node, contact, context);

      case 'ab_split':
      case 'multi_branch':
      case 'random_distribution':
        return { handle: 'yes', reason: 'not implemented — defaulting to yes' };

      default:
        log.warn({ subType: node.subType }, 'Unknown condition subType — defaulting to yes');
        return { handle: 'yes', reason: 'not implemented — defaulting to yes' };
    }
  }

  /**
   * Evaluate a yes/no condition node.
   *
   * Config supports two formats:
   * - Array: { conditions: [{ field, operator, value }], operator: 'AND' | 'OR' }
   * - Single (legacy): { field, operator, value }
   *
   * Supported operators: equals, not_equals, greater_than, less_than,
   *                      contains, not_contains, exists, not_exists
   */
  private evaluateYesNo(
    node: IFlowNode,
    contact: IContactDocument,
    context: Record<string, unknown>,
  ): ConditionResult {
    const config = node.config as Record<string, unknown>;

    let conditions: SingleCondition[];
    let joinOperator: 'AND' | 'OR' = 'AND';

    if (Array.isArray(config.conditions) && config.conditions.length > 0) {
      conditions = config.conditions as SingleCondition[];
      joinOperator = (config.operator as 'AND' | 'OR') ?? 'AND';
    } else if (config.field) {
      // Legacy single-condition format
      conditions = [
        {
          field: config.field as string,
          operator: config.operator as string,
          value: config.value,
        },
      ];
    } else {
      return { handle: 'yes', reason: 'No conditions configured' };
    }

    const results = conditions.map((cond) => {
      const actual = this.resolveField(cond.field, contact, context);
      const passed = this.compare(actual, cond.operator, cond.value);
      log.debug(
        { field: cond.field, operator: cond.operator, expected: cond.value, actual, passed },
        'Condition evaluated',
      );
      return passed;
    });

    const overall =
      joinOperator === 'OR' ? results.some(Boolean) : results.every(Boolean);

    const handle: 'yes' | 'no' = overall ? 'yes' : 'no';
    const reason = `${joinOperator}(${conditions.map((c) => `${c.field} ${c.operator} ${JSON.stringify(c.value)}`).join(', ')}) → ${handle}`;

    return { handle, reason };
  }

  /**
   * Resolve a field value from the contact or execution context.
   *
   * Supported fields: totalOrders, lifetimeValue, lifecycleStatus, tags,
   *   customFields.<key>, emailOptIn, smsOptIn, or any direct contact property.
   */
  private resolveField(
    field: string,
    contact: IContactDocument,
    context: Record<string, unknown>,
  ): unknown {
    // Handle customFields.<key> dot notation
    if (field.startsWith('customFields.')) {
      const key = field.slice('customFields.'.length);
      return contact.customFields?.[key];
    }

    // Direct contact properties
    const contactObj = (contact.toObject ? contact.toObject() : contact) as Record<string, unknown>;
    if (field in contactObj) {
      return contactObj[field];
    }

    // Execution context fallback
    if (field in context) {
      return context[field];
    }

    return undefined;
  }

  /**
   * Compare two values using the given operator.
   *
   * Supported: equals, not_equals, greater_than, less_than,
   *            contains, not_contains, exists, not_exists
   */
  private compare(actual: unknown, operator: string, expected: unknown): boolean {
    switch (operator) {
      case 'equals':
        // eslint-disable-next-line eqeqeq
        return actual == expected;

      case 'not_equals':
        // eslint-disable-next-line eqeqeq
        return actual != expected;

      case 'greater_than':
        return Number(actual) > Number(expected);

      case 'less_than':
        return Number(actual) < Number(expected);

      case 'contains':
        if (Array.isArray(actual)) {
          // For tags (ObjectId array) — compare as strings
          return actual.some((item) => String(item) === String(expected));
        }
        return typeof actual === 'string' && actual.includes(String(expected));

      case 'not_contains':
        if (Array.isArray(actual)) {
          return !actual.some((item) => String(item) === String(expected));
        }
        return typeof actual === 'string' && !actual.includes(String(expected));

      case 'exists':
        return actual !== undefined && actual !== null;

      case 'not_exists':
        return actual === undefined || actual === null;

      default:
        log.warn({ operator }, 'Unknown comparison operator — returning false');
        return false;
    }
  }
}
