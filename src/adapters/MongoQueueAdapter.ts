/**
 * @fileoverview MongoDB adapter for the QueuePort interface.
 *
 * Provides a polling-based message queue using MongoDB for environments
 * without Kafka (local development, testing). Messages are claimed
 * atomically via findOneAndUpdate to prevent duplicate consumption.
 *
 * Not intended for production scale — use KafkaQueueAdapter for that.
 *
 * @module adapters/MongoQueueAdapter
 */

import { createLogger } from '../config/logger.js';
import { QueueMessage as QueueMessageModel } from '../domain/models/QueueMessage.js';
import type { QueuePort, QueueMessage, MessageHandler, ConsumeOptions } from '../ports/QueuePort.js';

const log = createLogger('MongoQueueAdapter');

/** Polling interval in milliseconds */
const POLL_INTERVAL_MS = 1_000;

/**
 * MongoQueueAdapter — implements QueuePort using MongoDB polling.
 *
 * - publish() inserts a document with status 'pending'.
 * - consume() polls for pending messages, claims them atomically, and calls the handler.
 * - disconnect() stops all polling intervals.
 */
export class MongoQueueAdapter implements QueuePort {
  private pollingTimers: NodeJS.Timeout[] = [];

  /**
   * Publish a message to a MongoDB-backed topic.
   *
   * Inserts a document into the queue_messages collection with status 'pending'.
   */
  async publish(topic: string, message: QueueMessage): Promise<void> {
    await QueueMessageModel.create({
      topic,
      key: message.key,
      value: message.value,
      headers: message.headers ? new Map(Object.entries(message.headers)) : new Map(),
      status: 'pending',
      attempts: 0,
    });

    log.debug({ topic, key: message.key }, 'Published message to Mongo queue');
  }

  /**
   * Subscribe to a topic and process messages via polling.
   *
   * Polls the queue_messages collection every second for pending messages.
   * Uses findOneAndUpdate with status 'processing' to claim messages atomically.
   * Respects the concurrency option by limiting parallel processing.
   */
  async consume(
    topic: string,
    handler: MessageHandler,
    options?: ConsumeOptions,
  ): Promise<void> {
    const concurrency = options?.concurrency ?? 1;
    let activeJobs = 0;

    const poll = async (): Promise<void> => {
      // Respect concurrency limit
      while (activeJobs < concurrency) {
        const doc = await QueueMessageModel.findOneAndUpdate(
          { topic, status: 'pending' },
          { $set: { status: 'processing' }, $inc: { attempts: 1 } },
          { sort: { createdAt: 1 }, new: true },
        );

        if (!doc) break; // No more pending messages

        activeJobs++;

        // Process asynchronously to allow claiming more messages
        const processMessage = async (): Promise<void> => {
          try {
            // Convert Mongoose Map to plain object
            const headers: Record<string, string> = {};
            if (doc.headers) {
              for (const [k, v] of doc.headers.entries()) {
                headers[k] = v;
              }
            }

            const queueMessage: QueueMessage = {
              key: doc.key,
              value: doc.value as Record<string, unknown>,
              headers,
            };

            await handler(queueMessage);

            await QueueMessageModel.updateOne(
              { _id: doc._id },
              { $set: { status: 'completed' } },
            );
          } catch (err) {
            log.error({ err, topic, messageId: doc._id.toString() }, 'Error processing Mongo queue message');

            await QueueMessageModel.updateOne(
              { _id: doc._id },
              { $set: { status: 'failed' } },
            );
          } finally {
            activeJobs--;
          }
        };

        // Fire and forget — concurrency is controlled by the while loop + activeJobs counter
        processMessage().catch(() => {
          // Error already logged inside processMessage
        });
      }
    };

    const timer = setInterval(() => {
      poll().catch((err) => {
        log.error({ err, topic }, 'Polling error in MongoQueueAdapter');
      });
    }, POLL_INTERVAL_MS);

    this.pollingTimers.push(timer);
    log.info({ topic, concurrency }, 'Mongo queue consumer started (polling)');
  }

  /**
   * Stop all polling intervals.
   */
  async disconnect(): Promise<void> {
    for (const timer of this.pollingTimers) {
      clearInterval(timer);
    }
    this.pollingTimers = [];
    log.info('All Mongo queue consumers stopped');
  }
}
