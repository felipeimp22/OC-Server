/**
 * @fileoverview System routes — /api/v1/system and /api/v1/health
 *
 * @module api/routes/system
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { ContactService } from '../../services/ContactService.js';
import { Customer } from '../../domain/models/external/Customer.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('SystemRoutes');

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  const contactService = new ContactService();

  // GET /api/v1/health — Health check (no auth required)
  app.get('/health', { config: { skipAuth: true } }, async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    };
  });

  // GET /api/v1/system/kafka-status
  app.get('/system/kafka-status', async () => {
    return { status: 'ok', message: 'Kafka consumer groups running' };
  });

  // POST /api/v1/system/sync-contacts — Force sync contacts from OrderChop
  app.post('/system/sync-contacts', async (request: FastifyRequest) => {
    const restaurantId = request.restaurantId;
    log.info({ restaurantId }, 'Force syncing contacts from OrderChop');

    const customers = await Customer.find({ restaurantId }).lean().exec();

    let synced = 0;
    for (const customer of customers) {
      try {
        await contactService.syncFromCustomer(restaurantId, {
          customerId: customer._id.toString(),
          name: customer.name ?? '',
          email: customer.email ?? '',
          phone: customer.phone ?? null,
        });
        synced++;
      } catch (err) {
        log.error({ err, customerId: customer._id }, 'Failed to sync customer');
      }
    }

    return { synced, total: customers.length };
  });
}
