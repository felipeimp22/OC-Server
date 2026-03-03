/**
 * @fileoverview PrintDeadLetterConsumer — Kafka consumer that processes
 * permanently failed print jobs from the `print.jobs.dead-letter` topic.
 *
 * Responsibilities:
 * 1. Load the PrintJob from DB
 * 2. Ensure status is 'dead_letter' (update if not already set)
 * 3. Store the final error message
 * 4. Log the failure with full context for observability
 *
 * @module kafka/consumers/PrintDeadLetterConsumer
 */

import type { Consumer, EachMessagePayload } from 'kafkajs';
import { createConsumer } from '../../config/kafka.js';
import { createLogger } from '../../config/logger.js';
import { KAFKA_TOPICS } from '../topics.js';
import { PrintJobRepository } from '../../repositories/PrintJobRepository.js';

const log = createLogger('PrintDeadLetterConsumer');

export class PrintDeadLetterConsumer {
  private consumer: Consumer | null = null;
  private readonly printJobRepo: PrintJobRepository;

  constructor() {
    this.printJobRepo = new PrintJobRepository();
  }

  async start(): Promise<void> {
    this.consumer = createConsumer({ groupId: 'print-dead-letter-group' });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [KAFKA_TOPICS.PRINT_JOBS_DEAD_LETTER],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (messagePayload: EachMessagePayload) => {
        await this.handleMessage(messagePayload);
      },
    });

    log.info('Print dead-letter consumer started');
  }

  private async handleMessage({ message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    try {
      const payload = JSON.parse(message.value.toString());
      const { printJobId, restaurantId, printerId, orderId } = payload;

      if (!printJobId || !restaurantId) {
        log.warn({ payload }, 'Invalid dead-letter message — missing printJobId or restaurantId');
        return;
      }

      // Extract error context from headers
      const finalError = message.headers?.['final-error']
        ? Buffer.isBuffer(message.headers['final-error'])
          ? message.headers['final-error'].toString()
          : String(message.headers['final-error'])
        : 'Unknown error';

      const totalAttempts = message.headers?.['total-attempts']
        ? parseInt(
            Buffer.isBuffer(message.headers['total-attempts'])
              ? message.headers['total-attempts'].toString()
              : String(message.headers['total-attempts']),
            10,
          )
        : 0;

      // Load PrintJob from DB
      const printJob = await this.printJobRepo.findById(restaurantId, printJobId);

      if (!printJob) {
        log.warn({ printJobId, restaurantId }, 'Dead-lettered PrintJob not found in DB');
        return;
      }

      // Ensure status is 'dead_letter' (PrintJobConsumer usually sets this before
      // publishing, but we enforce it here as a safety net)
      if (printJob.status !== 'dead_letter') {
        await this.printJobRepo.updateStatus(restaurantId, printJobId, 'dead_letter', {
          lastError: finalError,
          attempts: totalAttempts || printJob.attempts,
        });
      }

      // Log with full context for observability / alerting
      log.error(
        {
          printJobId,
          restaurantId,
          printerId: printerId ?? printJob.printerId?.toString(),
          orderId: orderId ?? printJob.orderId?.toString(),
          error: finalError,
          attempts: totalAttempts || printJob.attempts,
        },
        'Print job permanently failed after %d attempts — dead-lettered',
        totalAttempts || printJob.attempts,
      );
    } catch (err) {
      log.error({ err }, 'Error processing dead-letter message');
    }
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      log.info('Print dead-letter consumer stopped');
    }
  }
}
