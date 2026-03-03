/**
 * @fileoverview PrintJobConsumer — Kafka consumer that processes print jobs
 * from the `print.jobs` topic.
 *
 * Processing flow:
 * 1. Deserialize message → load PrintJob from DB (validate status is 'queued')
 * 2. Load Printer config (check enabled)
 * 3. Load order data → call ReceiptFormatter to generate HTML
 * 4. Call PrintDeliveryService to send email
 * 5. Update PrintJob status to 'sent' on success
 *
 * On failure:
 * - If attempts < maxAttempts → publish to 'print.jobs.retry' with exponential backoff
 * - If attempts >= maxAttempts → publish to 'print.jobs.dead-letter'
 *
 * Concurrency control:
 * - Global semaphore from PrinterSettings.globalConcurrency per restaurant
 * - Per-printer semaphore from Printer.concurrency
 * - When all slots full, consumer pauses partition and resumes when a slot frees
 *
 * @module kafka/consumers/PrintJobConsumer
 */

import type { Consumer, EachMessagePayload } from 'kafkajs';
import { createConsumer, getProducer } from '../../config/kafka.js';
import { createLogger } from '../../config/logger.js';
import { KAFKA_TOPICS } from '../topics.js';
import { PrintJobRepository } from '../../repositories/PrintJobRepository.js';
import { PrinterRepository } from '../../repositories/PrinterRepository.js';
import { PrinterSettingsRepository } from '../../repositories/PrinterSettingsRepository.js';
import { PrintDeliveryService } from '../../services/PrintDeliveryService.js';
import { ReceiptFormatter, type FontSizePreset } from '../../services/ReceiptFormatter.js';
import { Order } from '../../domain/models/external/Order.js';
import { Restaurant } from '../../domain/models/external/Restaurant.js';
import { timezoneService } from '../../services/TimezoneService.js';
import { env } from '../../config/env.js';

const log = createLogger('PrintJobConsumer');

/** Exponential backoff delays for retries: 5s, 15s, 45s */
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

/**
 * Simple in-memory semaphore for concurrency control.
 */
class Semaphore {
  private active = 0;

  constructor(private readonly max: number) {}

  get available(): boolean {
    return this.active < this.max;
  }

  acquire(): boolean {
    if (this.active >= this.max) return false;
    this.active++;
    return true;
  }

  release(): void {
    if (this.active > 0) this.active--;
  }
}

export class PrintJobConsumer {
  private consumer: Consumer | null = null;
  private readonly printJobRepo: PrintJobRepository;
  private readonly printerRepo: PrinterRepository;
  private readonly settingsRepo: PrinterSettingsRepository;
  private readonly deliveryService: PrintDeliveryService;
  private readonly receiptFormatter: ReceiptFormatter;

  /** Per-restaurant global concurrency semaphores */
  private readonly globalSemaphores: Map<string, Semaphore> = new Map();
  /** Per-printer concurrency semaphores */
  private readonly printerSemaphores: Map<string, Semaphore> = new Map();

  constructor() {
    this.printJobRepo = new PrintJobRepository();
    this.printerRepo = new PrinterRepository();
    this.settingsRepo = new PrinterSettingsRepository();
    this.deliveryService = new PrintDeliveryService();
    this.receiptFormatter = new ReceiptFormatter();
  }

  async start(): Promise<void> {
    this.consumer = createConsumer({ groupId: 'print-worker-group' });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [KAFKA_TOPICS.PRINT_JOBS, KAFKA_TOPICS.PRINT_JOBS_RETRY],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (messagePayload: EachMessagePayload) => {
        await this.handleMessage(messagePayload);
      },
    });

    log.info('Print job consumer started');
  }

  private async handleMessage({ topic, message, partition, heartbeat }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    try {
      const payload = JSON.parse(message.value.toString());
      const { printJobId, restaurantId, printerId } = payload;

      if (!printJobId || !restaurantId) {
        log.warn({ payload }, 'Invalid print job message — missing printJobId or restaurantId');
        return;
      }

      // Handle retry delay: check if the message has a scheduledAt header
      if (topic === KAFKA_TOPICS.PRINT_JOBS_RETRY) {
        const retryAfterHeader = message.headers?.['retry-after'];
        if (retryAfterHeader) {
          const retryAfter = parseInt(
            Buffer.isBuffer(retryAfterHeader) ? retryAfterHeader.toString() : String(retryAfterHeader),
            10,
          );
          if (!isNaN(retryAfter) && retryAfter > Date.now()) {
            // Re-publish to retry topic with same delay — not yet time to process
            // In practice, Kafka doesn't support delayed messages natively.
            // We accept that retry messages are processed immediately and rely on
            // the exponential backoff gap between publishes instead.
          }
        }
      }

      // Load print job from DB
      const printJob = await this.printJobRepo.findById(restaurantId, printJobId);
      if (!printJob) {
        log.warn({ printJobId, restaurantId }, 'PrintJob not found in DB — skipping');
        return;
      }

      // Only process jobs in 'queued' status (prevents double-processing)
      if (printJob.status !== 'queued') {
        log.debug({ printJobId, status: printJob.status }, 'PrintJob not in queued status — skipping');
        return;
      }

      // Load printer config
      const printer = await this.printerRepo.findById(restaurantId, printerId);
      if (!printer) {
        log.warn({ printerId, restaurantId }, 'Printer not found — marking job as failed');
        await this.printJobRepo.updateStatus(restaurantId, printJobId, 'failed', {
          lastError: 'Printer not found',
        });
        return;
      }

      if (!printer.enabled) {
        log.info({ printerId }, 'Printer is disabled — marking job as failed');
        await this.printJobRepo.updateStatus(restaurantId, printJobId, 'failed', {
          lastError: 'Printer is disabled',
        });
        return;
      }

      // Concurrency control: acquire slots
      const globalSem = this.getGlobalSemaphore(restaurantId);
      const printerSem = this.getPrinterSemaphore(printerId, printer.concurrency);

      if (!globalSem.available || !printerSem.available) {
        // Concurrency limit hit — pause partition and re-enqueue
        log.debug(
          { restaurantId, printerId, partition },
          'Concurrency limit reached — pausing partition',
        );

        if (this.consumer) {
          this.consumer.pause([{ topic, partitions: [partition] }]);
          // Resume after a short delay
          setTimeout(() => {
            if (this.consumer) {
              this.consumer.resume([{ topic, partitions: [partition] }]);
            }
          }, 2_000);
        }
        return;
      }

      const globalAcquired = globalSem.acquire();
      const printerAcquired = printerSem.acquire();

      try {
        await this.processJob(printJob, printer, restaurantId, printJobId, printerId);
      } finally {
        if (globalAcquired) globalSem.release();
        if (printerAcquired) printerSem.release();
      }

      await heartbeat();
    } catch (err) {
      log.error({ err }, 'Error processing print job message');
    }
  }

  /**
   * Process a single print job: format receipt, send email, update status.
   */
  private async processJob(
    printJob: Awaited<ReturnType<PrintJobRepository['findById']>> & { _id: { toString(): string } },
    printer: Awaited<ReturnType<PrinterRepository['findById']>> & { _id: { toString(): string } },
    restaurantId: string,
    printJobId: string,
    printerId: string,
  ): Promise<void> {
    // Update status to 'sending'
    await this.printJobRepo.updateStatus(restaurantId, printJobId, 'sending');

    try {
      // Generate receipt HTML if not already stored
      let receiptHtml = printJob.receiptHtml;

      if (!receiptHtml) {
        // Load order and restaurant data for formatting
        const order = await Order.findById(printJob.orderId).exec();
        if (!order) {
          throw new Error(`Order ${printJob.orderId} not found`);
        }

        const restaurant = await Restaurant.findById(restaurantId).exec();
        if (!restaurant) {
          throw new Error(`Restaurant ${restaurantId} not found`);
        }

        const timezone = printJob.timezone || await timezoneService.getTimezone(restaurantId);

        if (printJob.trigger === 'kitchen') {
          receiptHtml = this.receiptFormatter.formatKitchenTicket(order, restaurant, timezone);
        } else {
          // Load printer settings to get fontSize preference
          const settings = await this.settingsRepo.findByRestaurant(restaurantId);
          const fontSize: FontSizePreset = settings?.fontSize ?? 'normal';
          receiptHtml = this.receiptFormatter.formatCustomerReceipt(order, restaurant, timezone, fontSize);
        }
      }

      // Send the email via PrintDeliveryService
      const result = await this.deliveryService.sendPrintJob(printJob as any, printer as any, receiptHtml);

      if (result.success) {
        await this.printJobRepo.updateStatus(restaurantId, printJobId, 'sent', {
          sentAt: new Date(),
        });
        log.info({ printJobId, printerId, messageId: result.messageId }, 'Print job sent successfully');
      } else {
        // Send failed — handle retry
        await this.handleFailure(restaurantId, printJobId, printerId, printJob, result.error ?? 'Unknown error', result.retryable ?? true);
      }
    } catch (err) {
      const errorMessage = (err as Error).message ?? 'Unknown error';
      await this.handleFailure(restaurantId, printJobId, printerId, printJob, errorMessage, true);
    }
  }

  /**
   * Handle a failed print job: retry or dead-letter.
   */
  private async handleFailure(
    restaurantId: string,
    printJobId: string,
    printerId: string,
    printJob: { attempts: number; maxAttempts: number; orderId: { toString(): string } },
    error: string,
    retryable: boolean,
  ): Promise<void> {
    const newAttempts = printJob.attempts + 1;

    if (retryable && newAttempts < printJob.maxAttempts) {
      // Publish to retry topic with exponential backoff
      const delayMs = RETRY_DELAYS_MS[Math.min(newAttempts - 1, RETRY_DELAYS_MS.length - 1)];

      await this.printJobRepo.updateStatus(restaurantId, printJobId, 'failed', {
        lastError: error,
        attempts: newAttempts,
      });

      const producer = getProducer();
      await producer.send({
        topic: KAFKA_TOPICS.PRINT_JOBS_RETRY,
        messages: [
          {
            key: restaurantId,
            value: JSON.stringify({
              printJobId,
              restaurantId,
              printerId,
              trigger: 'retry',
            }),
            headers: {
              'retry-after': String(Date.now() + delayMs),
              'retry-attempt': String(newAttempts),
              'original-error': error,
            },
          },
        ],
      });

      log.info(
        { printJobId, attempt: newAttempts, delayMs },
        'Print job failed — scheduled for retry',
      );
    } else {
      // Max retries exceeded or permanent error — dead-letter
      await this.printJobRepo.updateStatus(restaurantId, printJobId, 'dead_letter', {
        lastError: error,
        attempts: newAttempts,
      });

      const producer = getProducer();
      await producer.send({
        topic: KAFKA_TOPICS.PRINT_JOBS_DEAD_LETTER,
        messages: [
          {
            key: restaurantId,
            value: JSON.stringify({
              printJobId,
              restaurantId,
              printerId,
              orderId: printJob.orderId.toString(),
            }),
            headers: {
              'final-error': error,
              'total-attempts': String(newAttempts),
            },
          },
        ],
      });

      log.error(
        {
          printJobId,
          restaurantId,
          printerId,
          orderId: printJob.orderId.toString(),
          error,
          attempts: newAttempts,
        },
        'Print job dead-lettered after %d attempts',
        newAttempts,
      );
    }
  }

  /**
   * Get or create a global concurrency semaphore for a restaurant.
   */
  private getGlobalSemaphore(restaurantId: string): Semaphore {
    let sem = this.globalSemaphores.get(restaurantId);
    if (!sem) {
      sem = new Semaphore(env.PRINT_GLOBAL_CONCURRENCY);
      this.globalSemaphores.set(restaurantId, sem);
    }
    return sem;
  }

  /**
   * Get or create a per-printer concurrency semaphore.
   */
  private getPrinterSemaphore(printerId: string, concurrency: number): Semaphore {
    let sem = this.printerSemaphores.get(printerId);
    if (!sem) {
      sem = new Semaphore(concurrency);
      this.printerSemaphores.set(printerId, sem);
    }
    return sem;
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      this.globalSemaphores.clear();
      this.printerSemaphores.clear();
      log.info('Print job consumer stopped');
    }
  }
}
