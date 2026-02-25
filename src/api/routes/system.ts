/**
 * @fileoverview System routes — /api/v1/system and /api/v1/health
 *
 * @module api/routes/system
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { ContactService } from '../../services/ContactService.js';
import { CommunicationService } from '../../services/CommunicationService.js';
import { Customer } from '../../domain/models/external/Customer.js';
import { env } from '../../config/env.js';
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

  // POST /api/v1/system/test-email — Send a test email (dev only)
  app.post('/system/test-email', async (request: FastifyRequest, reply: FastifyReply) => {
    if (env.NODE_ENV === 'production') {
      return reply.code(403).send({ error: 'Not available in production' });
    }

    const { to, subject, body } = (request.body ?? {}) as {
      to?: string;
      subject?: string;
      body?: string;
    };

    if (!to) {
      return reply.code(400).send({ error: '"to" email address is required' });
    }

    const commService = new CommunicationService();
    try {
      const result = await commService.sendEmail({
        restaurantId: request.restaurantId,
        contactId: 'test-manual',
        to,
        subject: subject ?? 'CRM Engine Test Email',
        body: body ?? '<h1>It works!</h1><p>This is a test email from oc-crm-engine.</p>',
        context: { first_name: 'Test', restaurant_name: 'OrderChop' },
      });

      log.info({ to, status: result.status }, 'Test email sent');
      return { success: true, status: result.status, id: result._id };
    } catch (err: any) {
      log.error({ err, to }, 'Test email failed');
      return reply.code(500).send({ error: err.message });
    }
  });
}
