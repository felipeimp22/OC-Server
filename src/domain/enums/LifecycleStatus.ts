/**
 * @fileoverview Lifecycle status enum for CRM contacts.
 * Represents the customer journey stages within the restaurant CRM.
 *
 * Transitions:
 * - lead → first_time (after first order)
 * - first_time → returning (2+ orders in 90 days)
 * - returning → lost (no order in 60+ days)
 * - lost → recovered (orders again after being lost)
 * - any → VIP (meets LTV or order count threshold)
 *
 * @module domain/enums/LifecycleStatus
 */

/** All possible lifecycle statuses for a CRM contact */
export const LifecycleStatus = {
  /** Contact exists but has never ordered */
  LEAD: 'lead',
  /** Contact has placed exactly one order */
  FIRST_TIME: 'first_time',
  /** Contact has placed 2+ orders within the last 90 days */
  RETURNING: 'returning',
  /** Contact was returning but hasn't ordered in 60+ days */
  LOST: 'lost',
  /** Contact was lost but has placed a new order */
  RECOVERED: 'recovered',
  /** Contact meets VIP criteria (high LTV or order count) */
  VIP: 'VIP',
} as const;

/** Union type of all lifecycle status values */
export type LifecycleStatus = (typeof LifecycleStatus)[keyof typeof LifecycleStatus];

/** Array of all lifecycle statuses for iteration / validation */
export const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = Object.values(LifecycleStatus);
