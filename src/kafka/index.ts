/**
 * @fileoverview Barrel export for the Kafka layer.
 *
 * @module kafka
 */

export { KAFKA_TOPICS, CONSUMER_TOPICS, type KafkaTopic } from './topics.js';
export { produceContactEvent, produceNotification } from './producers/CRMEventProducer.js';
export { produceFlowStepReady, produceFlowTimerExpired } from './producers/FlowEventProducer.js';
export { OrderEventConsumer } from './consumers/OrderEventConsumer.js';
export { CustomerEventConsumer } from './consumers/CustomerEventConsumer.js';
export { CartEventConsumer, abandonedCartQueue, ABANDONED_CART_QUEUE } from './consumers/CartEventConsumer.js';
export { CRMEventConsumer } from './consumers/CRMEventConsumer.js';
export { PrintJobConsumer } from './consumers/PrintJobConsumer.js';
export { PrintDeadLetterConsumer } from './consumers/PrintDeadLetterConsumer.js';
