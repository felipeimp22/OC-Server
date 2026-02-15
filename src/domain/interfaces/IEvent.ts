/**
 * @fileoverview Base event interface for all Kafka messages.
 * Every event flowing through the CRM engine — incoming from OrderChop,
 * internal between services, or outgoing — conforms to this shape.
 *
 * @module domain/interfaces/IEvent
 */

/**
 * Base event interface for all Kafka messages processed by the CRM engine.
 *
 * @example
 * ```typescript
 * const event: ICRMEvent = {
 *   eventId: '550e8400-e29b-41d4-a716-446655440000',
 *   eventType: 'order.completed',
 *   restaurantId: '64a1b2c3d4e5f6a7b8c9d0e1',
 *   timestamp: '2026-02-13T10:30:00.000Z',
 *   payload: {
 *     orderId: '64a1b2c3d4e5f6a7b8c9d0e2',
 *     customerId: '64a1b2c3d4e5f6a7b8c9d0e3',
 *     customerEmail: 'john@example.com',
 *     orderTotal: 25.50,
 *     orderType: 'delivery',
 *   },
 * };
 * ```
 */
export interface ICRMEvent {
  /** UUID for idempotent processing — must be unique per event */
  eventId: string;

  /** Dot-separated event type (e.g., "order.completed", "contact.tag_applied") */
  eventType: string;

  /** MongoDB ObjectId (as string) of the restaurant this event belongs to */
  restaurantId: string;

  /** ISO 8601 timestamp of when the event occurred */
  timestamp: string;

  /** Event-specific payload data */
  payload: ICRMEventPayload;
}

/**
 * Flexible payload for CRM events.
 * Known optional fields are typed explicitly; additional fields
 * are allowed via the index signature.
 */
export interface ICRMEventPayload {
  /** MongoDB ObjectId of the related order */
  orderId?: string;
  /** MongoDB ObjectId of the related customer (from OrderChop Customer collection) */
  customerId?: string;
  /** Customer email address */
  customerEmail?: string;
  /** Customer name */
  customerName?: string;
  /** Order total amount */
  orderTotal?: number;
  /** Order type (pickup, delivery, dine_in) */
  orderType?: string;
  /** Payment status */
  paymentStatus?: string;
  /** Previous order status (for status change events) */
  oldStatus?: string;
  /** New order status (for status change events) */
  newStatus?: string;
  /** Tag ID (for tag_applied / tag_removed events) */
  tagId?: string;
  /** Tag name (for tag_applied / tag_removed events) */
  tagName?: string;
  /** Custom field key (for field_changed events) */
  fieldKey?: string;
  /** Custom field old value */
  fieldOldValue?: unknown;
  /** Custom field new value */
  fieldNewValue?: unknown;
  /** Flow execution ID (for flow events) */
  executionId?: string;
  /** Flow ID */
  flowId?: string;
  /** Contact ID (CRM contact) */
  contactId?: string;
  /** Node ID within a flow */
  nodeId?: string;
  /** Allow additional event-specific fields */
  [key: string]: unknown;
}
