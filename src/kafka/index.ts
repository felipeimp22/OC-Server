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
export { CartEventConsumer } from './consumers/CartEventConsumer.js';
export { CRMEventConsumer } from './consumers/CRMEventConsumer.js';
