/**
 * @fileoverview Action type enum — all possible flow action subtypes.
 * When a flow reaches an action node, the ActionService dispatches
 * execution based on the subType.
 *
 * @module domain/enums/ActionType
 */

/** All action subtypes for flow action nodes */
export const ActionType = {
  // ── Communication ──────────────────────────────────────
  /** Send an email to the contact using a template */
  SEND_EMAIL: 'send_email',
  /** Send an SMS to the contact using a template */
  SEND_SMS: 'send_sms',
  /** Send a notification email/SMS to the restaurant admin */
  ADMIN_NOTIFICATION: 'admin_notification',

  // ── CRM Actions ────────────────────────────────────────
  /** Apply a tag to the contact */
  APPLY_TAG: 'apply_tag',
  /** Remove a tag from the contact */
  REMOVE_TAG: 'remove_tag',
  /** Update a custom field value on the contact */
  UPDATE_FIELD: 'update_field',
  /** Add a note to the contact's timeline */
  ADD_NOTE: 'add_note',
  /** Create a task associated with the contact */
  CREATE_TASK: 'create_task',
  /** Assign an owner to the contact */
  ASSIGN_OWNER: 'assign_owner',

  // ── Advertising ────────────────────────────────────────
  /** Send a Meta Conversions API event */
  META_CAPI: 'meta_capi_event',

  // ── Developer ──────────────────────────────────────────
  /** POST to an external webhook URL */
  OUTGOING_WEBHOOK: 'outgoing_webhook',
} as const;

/** Union type of all action type values */
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

/** Array of all action types for iteration / validation */
export const ACTION_TYPES: readonly ActionType[] = Object.values(ActionType);
