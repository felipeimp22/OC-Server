/**
 * @fileoverview Kafka adapter for the QueuePort interface.
 *
 * Wraps the existing KafkaJS producer/consumer infrastructure from
 * config/kafka.ts so the print system (and future queue consumers)
 * can publish and consume messages through the QueuePort abstraction.
 *
 * @module adapters/KafkaQueueAdapter
 */

import type { Consumer } from 'kafkajs';
import { getProducer, createConsumer } from '../config/kafka.js';
import { createLogger } from '../config/logger.js';
import type { QueuePort, QueueMessage, MessageHandler, ConsumeOptions } from '../ports/QueuePort.js';

const log = createLogger('KafkaQueueAdapter');

/**
 * KafkaQueueAdapter — implements QueuePort using existing KafkaJS infrastructure.
 *
 * - publish() uses the singleton Kafka producer (already connected at startup).
 * - consume() creates a new KafkaJS consumer per subscription.
 * - disconnect() gracefully disconnects all consumers created by this adapter.
 */
export class KafkaQueueAdapter implements QueuePort {
  private consumers: Consumer[] = [];

  /**
   * Publish a message to a Kafka topic.
   *
   * Serializes message.value to JSON, uses message.key for partition keying,
   * and forwards message.headers as Kafka record headers.
   */
  async publish(topic: string, message: QueueMessage): Promise<void> {
    const producer = getProducer();

    const headers: Record<string, string> | undefined = message.headers;

    await producer.send({
      topic,
      messages: [
        {
          key: message.key,
          value: JSON.stringify(message.value),
          headers,
        },
      ],
    });

    log.debug({ topic, key: message.key }, 'Published message to Kafka topic');
  }

  /**
   * Subscribe to a Kafka topic and process messages via the handler.
   *
   * Creates a new KafkaJS consumer with the provided groupId (defaults to
   * 'print-worker-group'). Respects options.concurrency via KafkaJS's
   * partitionsConsumedConcurrently setting.
   */
  async consume(
    topic: string,
    handler: MessageHandler,
    options?: ConsumeOptions,
  ): Promise<void> {
    const groupId = options?.groupId ?? 'print-worker-group';
    const concurrency = options?.concurrency ?? 1;

    const consumer = createConsumer({ groupId });
    this.consumers.push(consumer);

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    await consumer.run({
      partitionsConsumedConcurrently: concurrency,
      eachMessage: async ({ message: kafkaMessage }) => {
        if (!kafkaMessage.value) return;

        try {
          const value = JSON.parse(kafkaMessage.value.toString()) as Record<string, unknown>;
          const key = kafkaMessage.key?.toString() ?? '';

          // Convert Kafka headers (Buffer values) to plain string record
          const headers: Record<string, string> = {};
          if (kafkaMessage.headers) {
            for (const [k, v] of Object.entries(kafkaMessage.headers)) {
              if (v !== undefined && v !== null) {
                headers[k] = Buffer.isBuffer(v) ? v.toString() : String(v);
              }
            }
          }

          const queueMessage: QueueMessage = { key, value, headers };
          await handler(queueMessage);
        } catch (err) {
          log.error({ err, topic, offset: kafkaMessage.offset }, 'Error processing Kafka message');
        }
      },
    });

    log.info({ topic, groupId, concurrency }, 'Kafka consumer started');
  }

  /**
   * Gracefully disconnect all consumers created by this adapter.
   */
  async disconnect(): Promise<void> {
    for (const consumer of this.consumers) {
      try {
        await consumer.disconnect();
      } catch (err) {
        log.warn({ err }, 'Error disconnecting Kafka consumer');
      }
    }
    this.consumers = [];
    log.info('All Kafka consumers disconnected');
  }
}
