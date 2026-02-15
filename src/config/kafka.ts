/**
 * @fileoverview Kafka client configuration (KafkaJS).
 *
 * Creates a singleton Kafka client, producer, and consumer factory.
 * The producer is connected once at startup; consumers are created
 * per topic group in the Kafka consumer layer.
 *
 * @module config/kafka
 */

import { Kafka, type Producer, type Consumer, type ConsumerConfig, logLevel } from 'kafkajs';
import { env } from './env.js';
import { createLogger } from './logger.js';

const log = createLogger('kafka');

/**
 * Map KafkaJS log levels to Pino log levels.
 */
function kafkaLogCreator() {
  return ({ namespace, level, log: logEntry }: { namespace: string; level: logLevel; log: { message: string; [key: string]: unknown } }) => {
    const { message, ...extra } = logEntry;
    const childLog = log.child({ kafkaNamespace: namespace });

    switch (level) {
      case logLevel.ERROR:
      case logLevel.NOTHING:
        childLog.error(extra, message);
        break;
      case logLevel.WARN:
        childLog.warn(extra, message);
        break;
      case logLevel.INFO:
        childLog.info(extra, message);
        break;
      case logLevel.DEBUG:
        childLog.debug(extra, message);
        break;
    }
  };
}

/**
 * Singleton Kafka client instance.
 * Brokers are parsed from the comma-separated KAFKA_BROKERS env var.
 */
export const kafka = new Kafka({
  clientId: env.KAFKA_CLIENT_ID,
  brokers: env.KAFKA_BROKERS.split(',').map((b) => b.trim()),
  logLevel: env.NODE_ENV === 'development' ? logLevel.WARN : logLevel.ERROR,
  logCreator: kafkaLogCreator,
  retry: {
    initialRetryTime: 300,
    retries: 10,
  },
});

/** Singleton Kafka producer (connected at startup) */
let producer: Producer | null = null;

/**
 * Get or create the Kafka producer singleton.
 * Must call `connectProducer()` before sending messages.
 */
export function getProducer(): Producer {
  if (!producer) {
    producer = kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30_000,
    });
  }
  return producer;
}

/**
 * Connect the Kafka producer.
 * Called once at application startup.
 */
export async function connectProducer(): Promise<void> {
  const p = getProducer();
  try {
    await p.connect();
    log.info('Kafka producer connected');
  } catch (err) {
    log.error({ err }, 'Failed to connect Kafka producer');
    throw err;
  }
}

/**
 * Disconnect the Kafka producer.
 * Called during application shutdown.
 */
export async function disconnectProducer(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    log.info('Kafka producer disconnected');
    producer = null;
  }
}

/**
 * Create a new Kafka consumer for a specific group/topic.
 *
 * @param config - Consumer configuration (groupId is required)
 * @returns A KafkaJS Consumer instance (not yet connected or subscribed)
 *
 * @example
 * ```ts
 * const consumer = createConsumer({ groupId: 'crm-order-consumer' });
 * await consumer.connect();
 * await consumer.subscribe({ topic: 'orderchop.orders' });
 * await consumer.run({ eachMessage: async ({ message }) => { ... } });
 * ```
 */
export function createConsumer(config: ConsumerConfig): Consumer {
  return kafka.consumer(config);
}
