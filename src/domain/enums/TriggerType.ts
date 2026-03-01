/**
 * @fileoverview Trigger type enum — all possible flow trigger subtypes.
 * When an event occurs, the TriggerService matches it against these types
 * to determine which flows should enroll the contact.
 *
 * @module domain/enums/TriggerType
 */

/** All trigger subtypes for flow trigger nodes */
export const TriggerType = {
  // ── OrderChop Triggers ──────────────────────────────────
  /** Fires when a new order is placed and payment is confirmed */
  NEW_ORDER: 'new_order',
  /** Fires when a new order is created */
  ORDER_CREATED: 'order_created',
  /** Fires when an order is confirmed (payment received) */
  ORDER_CONFIRMED: 'order_confirmed',
  /** Fires when an order reaches "completed" status */
  ORDER_COMPLETED: 'order_completed',
  /** Fires when an order is cancelled */
  ORDER_CANCELLED: 'order_cancelled',
  /** Fires when a payment succeeds */
  PAYMENT_SUCCEEDED: 'payment_succeeded',
  /** Fires when a payment fails */
  PAYMENT_FAILED: 'payment_failed',
  /** Fires when payment status changes (any transition) */
  PAYMENT_STATUS_CHANGED: 'payment_status_changed',
  /** Fires when order status changes (any transition) */
  ORDER_STATUS_CHANGED: 'order_status_changed',
  /** Fires when a cart is abandoned (no checkout within timeout) */
  ABANDONED_CART: 'abandoned_cart',
  /** Fires on the customer's very first order */
  FIRST_ORDER: 'first_order',
  /** Fires on the customer's Nth order (configurable) */
  NTH_ORDER: 'nth_order',
  /** Fires when customer has not ordered in X days (scheduled) */
  NO_ORDER_IN_X_DAYS: 'no_order_in_x_days',

  // ── CRM Triggers ───────────────────────────────────────
  /** Fires when a tag is applied to a contact */
  TAG_APPLIED: 'tag_applied',
  /** Fires when a tag is removed from a contact */
  TAG_REMOVED: 'tag_removed',
  /** Fires when email or SMS opt-in status changes */
  OPT_IN_CHANGED: 'opt_in_changed',
  /** Fires when a custom field value changes */
  FIELD_CHANGED: 'field_changed',
  /** Fires on the contact's birthday (scheduled daily) */
  CONTACT_BIRTHDAY: 'contact_birthday',
  /** Fires when a task assigned to a contact is completed */
  TASK_COMPLETED: 'task_completed',

  // ── Activity Triggers ──────────────────────────────────
  /** Fires when a tracked link is clicked */
  LINK_CLICKED: 'link_clicked',
  /** Fires when a tracked page is visited */
  PAGE_VISITED: 'page_visited',
  /** Fires when an inbound SMS reply is received */
  SMS_REPLY: 'sms_reply',
  /** Fires when a form submission is received */
  FORM_SUBMISSION: 'form_submission',

  // ── Developer Triggers ─────────────────────────────────
  /** Fires on an incoming POST webhook */
  WEBHOOK_INCOMING: 'webhook_incoming',
} as const;

/** Union type of all trigger type values */
export type TriggerType = (typeof TriggerType)[keyof typeof TriggerType];

/** Array of all trigger types for iteration / validation */
export const TRIGGER_TYPES: readonly TriggerType[] = Object.values(TriggerType);
