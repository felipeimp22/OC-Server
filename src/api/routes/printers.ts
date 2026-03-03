/**
 * @fileoverview Printer routes — /api/v1/printers
 *
 * Endpoints for printer CRUD, settings management, print job operations,
 * and manual print triggers. All endpoints require auth and are scoped
 * to the authenticated restaurantId.
 *
 * @module api/routes/printers
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrinterRepository } from '../../repositories/PrinterRepository.js';
import { PrintJobRepository } from '../../repositories/PrintJobRepository.js';
import { PrinterSettingsRepository } from '../../repositories/PrinterSettingsRepository.js';
import { PrintDeliveryService } from '../../services/PrintDeliveryService.js';
import { ReceiptFormatter } from '../../services/ReceiptFormatter.js';
import { timezoneService } from '../../services/TimezoneService.js';
import { Order } from '../../domain/models/external/Order.js';
import { Restaurant } from '../../domain/models/external/Restaurant.js';
import { getProducer } from '../../config/kafka.js';
import { KAFKA_TOPICS } from '../../kafka/topics.js';
import { env } from '../../config/env.js';
import {
  createPrinterBody,
  updatePrinterBody,
  updatePrinterSettingsBody,
  printJobFiltersQuery,
} from '../validators/index.js';

export async function printerRoutes(app: FastifyInstance): Promise<void> {
  const printerRepo = new PrinterRepository();
  const printJobRepo = new PrintJobRepository();
  const settingsRepo = new PrinterSettingsRepository();
  const deliveryService = new PrintDeliveryService();
  const receiptFormatter = new ReceiptFormatter();

  // ── Printer CRUD ──

  // GET /api/v1/printers — List printers for restaurant
  app.get('/', async (request: FastifyRequest) => {
    const printers = await printerRepo.findByRestaurant(request.restaurantId);
    return printers;
  });

  // POST /api/v1/printers — Register new printer
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createPrinterBody.parse(request.body);
    const printer = await printerRepo.create({
      restaurantId: request.restaurantId,
      ...body,
    } as any);
    return reply.code(201).send(printer);
  });

  // PUT /api/v1/printers/:printerId — Update printer config
  app.put('/:printerId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { printerId } = request.params as { printerId: string };
    const body = updatePrinterBody.parse(request.body);
    const printer = await printerRepo.updateById(request.restaurantId, printerId, { $set: body });
    if (!printer) return reply.code(404).send({ error: 'Printer not found' });
    return printer;
  });

  // DELETE /api/v1/printers/:printerId — Remove printer
  app.delete('/:printerId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { printerId } = request.params as { printerId: string };
    const deleted = await printerRepo.deleteById(request.restaurantId, printerId);
    if (!deleted) return reply.code(404).send({ error: 'Printer not found' });
    return { success: true };
  });

  // ── Printer Settings ──

  // GET /api/v1/printers/settings — Get restaurant printer settings
  app.get('/settings', async (request: FastifyRequest) => {
    const settings = await settingsRepo.findByRestaurant(request.restaurantId);
    // Return defaults if no settings document exists
    if (!settings) {
      return {
        enabled: false,
        autoPrint: true,
        printPickup: true,
        printDelivery: true,
        printDineIn: true,
        distributionMode: 'duplicate',
        emailFrom: null,
      };
    }
    return {
      _id: settings._id,
      restaurantId: settings.restaurantId,
      enabled: settings.enabled,
      autoPrint: settings.autoPrint,
      printPickup: settings.printPickup,
      printDelivery: settings.printDelivery,
      printDineIn: settings.printDineIn,
      distributionMode: settings.distributionMode ?? 'duplicate',
      emailFrom: settings.emailFrom ?? null,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  });

  // PUT /api/v1/printers/settings — Update printer settings
  app.put('/settings', async (request: FastifyRequest) => {
    const body = updatePrinterSettingsBody.parse(request.body);
    const settings = await settingsRepo.upsert(request.restaurantId, body as any);
    return settings;
  });

  // ── Print Jobs ──

  // GET /api/v1/printers/jobs — List print jobs with filters
  app.get('/jobs', async (request: FastifyRequest) => {
    const query = printJobFiltersQuery.parse(request.query);
    const filters: {
      status?: string;
      printerId?: string;
      from?: Date;
      to?: Date;
    } = {};
    if (query.status) filters.status = query.status;
    if (query.printerId) filters.printerId = query.printerId;
    if (query.from) filters.from = new Date(query.from);
    if (query.to) filters.to = new Date(query.to);

    const result = await printJobRepo.findPaginated(
      request.restaurantId,
      {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.printerId ? { printerId: filters.printerId } : {}),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { $gte: filters.from } : {}),
                ...(filters.to ? { $lte: filters.to } : {}),
              },
            }
          : {}),
      } as any,
      {
        page: query.page,
        limit: query.limit,
        sortBy: query.sort ?? 'createdAt',
        sortOrder: query.order,
      },
    );
    return result;
  });

  // GET /api/v1/printers/jobs/stats — Print job stats by status
  app.get('/jobs/stats', async (request: FastifyRequest) => {
    const stats = await printJobRepo.getStats(request.restaurantId);
    return stats;
  });

  // POST /api/v1/printers/jobs/:printJobId/retry — Retry a failed/dead_letter job
  app.post('/jobs/:printJobId/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    const { printJobId } = request.params as { printJobId: string };
    const printJob = await printJobRepo.findById(request.restaurantId, printJobId);
    if (!printJob) return reply.code(404).send({ error: 'Print job not found' });

    if (printJob.status !== 'failed' && printJob.status !== 'dead_letter') {
      return reply.code(400).send({ error: `Cannot retry a job with status '${printJob.status}'` });
    }

    // Reset and re-queue
    await printJobRepo.updateStatus(request.restaurantId, printJobId, 'queued', {
      attempts: 0,
      lastError: undefined,
    } as any);

    // Publish to Kafka print.jobs topic
    if (env.ENABLE_KAFKA) {
      const producer = getProducer();
      await producer.send({
        topic: KAFKA_TOPICS.PRINT_JOBS,
        messages: [
          {
            key: printJob.restaurantId.toString(),
            value: JSON.stringify({
              printJobId: printJob._id.toString(),
              restaurantId: printJob.restaurantId.toString(),
              printerId: printJob.printerId.toString(),
              orderId: printJob.orderId.toString(),
              trigger: 'retry',
            }),
          },
        ],
      });
    }

    return { success: true, printJobId };
  });

  // ── Printer Actions ──

  // POST /api/v1/printers/:printerId/test — Send test print
  app.post('/:printerId/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const { printerId } = request.params as { printerId: string };
    const printer = await printerRepo.findById(request.restaurantId, printerId);
    if (!printer) return reply.code(404).send({ error: 'Printer not found' });

    const restaurant = await Restaurant.findById(request.restaurantId).lean().exec();
    const restaurantName = restaurant?.name ?? 'Restaurant';

    const result = await deliveryService.sendTestPrint(printer, restaurantName);
    if (!result.success) {
      return reply.code(502).send({ error: result.error ?? 'Test print failed' });
    }
    return { success: true, messageId: result.messageId };
  });

  // POST /api/v1/printers/orders/:orderId/print — Manually trigger print for an order
  // NOTE: Manual print ALWAYS sends to ALL matching printers regardless of distributionMode.
  // This is intentional — the user explicitly chose to print, so we duplicate to every printer.
  // Distribution mode (round-robin) only applies to automatic triggers (auto-print, kitchen print).
  app.post('/orders/:orderId/print', async (request: FastifyRequest, reply: FastifyReply) => {
    const { orderId } = request.params as { orderId: string };

    const order = await Order.findById(orderId).lean().exec();
    if (!order) return reply.code(404).send({ error: 'Order not found' });

    // Find enabled printers for this restaurant — always send to ALL (no distribution filtering)
    const orderType = (order as any).type ?? 'pickup';
    const printers = await printerRepo.findEnabledByRestaurantAndOrderType(
      request.restaurantId,
      orderType,
    );

    if (printers.length === 0) {
      return reply.code(400).send({ error: 'No enabled printers configured for this order type' });
    }

    const restaurant = await Restaurant.findById(request.restaurantId).lean().exec();
    const timezone = await timezoneService.getTimezone(request.restaurantId);

    const createdJobs: string[] = [];

    for (const printer of printers) {
      // Generate receipt HTML based on printer type
      const receiptHtml =
        printer.type === 'kitchen'
          ? receiptFormatter.formatKitchenTicket(order as any, restaurant as any, timezone)
          : receiptFormatter.formatCustomerReceipt(order as any, restaurant as any, timezone);

      // Create PrintJob
      const printJob = await printJobRepo.create({
        restaurantId: request.restaurantId,
        printerId: printer._id,
        orderId,
        status: 'queued',
        trigger: 'manual',
        receiptHtml,
        timezone,
        scheduledAt: new Date(),
      } as any);

      // Publish to Kafka
      if (env.ENABLE_KAFKA) {
        const producer = getProducer();
        await producer.send({
          topic: KAFKA_TOPICS.PRINT_JOBS,
          messages: [
            {
              key: request.restaurantId,
              value: JSON.stringify({
                printJobId: printJob._id.toString(),
                restaurantId: request.restaurantId,
                printerId: printer._id.toString(),
                orderId,
                trigger: 'manual',
              }),
            },
          ],
        });
      }

      createdJobs.push(printJob._id.toString());
    }

    return reply.code(201).send({
      success: true,
      printJobIds: createdJobs,
      printerCount: printers.length,
    });
  });
}
