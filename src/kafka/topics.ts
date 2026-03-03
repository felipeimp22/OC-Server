/**
 * @fileoverview Kafka topic constants.
 *
 * @module kafka/topics
 */

export const KAFKA_TOPICS = {
  // ── Incoming (produced by OrderChop Next.js → consumed by CRM Engine)
  ORDERCHOP_ORDERS: 'orderchop.orders',
  ORDERCHOP_PAYMENTS: 'orderchop.payments',
  ORDERCHOP_CUSTOMERS: 'orderchop.customers',
  ORDERCHOP_CARTS: 'orderchop.carts',

  // ── Internal (produced & consumed within CRM Engine)
  CRM_FLOW_EXECUTE: 'crm.flow.execute',
  CRM_FLOW_TIMER: 'crm.flow.timer',
  CRM_COMMUNICATIONS: 'crm.communications',
  CRM_CONTACTS: 'crm.contacts',

  // ── Outgoing (produced by CRM Engine → consumed by OrderChop Next.js)
  CRM_NOTIFICATIONS: 'crm.notifications',

  // ── Print System (produced & consumed within CRM Engine)
  PRINT_JOBS: 'print.jobs',
  PRINT_JOBS_RETRY: 'print.jobs.retry',
  PRINT_JOBS_DEAD_LETTER: 'print.jobs.dead-letter',
} as const;

export type KafkaTopic = (typeof KAFKA_TOPICS)[keyof typeof KAFKA_TOPICS];

/** All topics the CRM engine subscribes to */
export const CONSUMER_TOPICS: KafkaTopic[] = [
  KAFKA_TOPICS.ORDERCHOP_ORDERS,
  KAFKA_TOPICS.ORDERCHOP_PAYMENTS,
  KAFKA_TOPICS.ORDERCHOP_CUSTOMERS,
  KAFKA_TOPICS.ORDERCHOP_CARTS,
  KAFKA_TOPICS.CRM_FLOW_EXECUTE,
  KAFKA_TOPICS.CRM_FLOW_TIMER,
  KAFKA_TOPICS.CRM_CONTACTS,
];
