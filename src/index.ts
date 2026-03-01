/**
 * @fileoverview Main entry point for the oc-crm-engine microservice.
 *
 * Bootstrap sequence:
 * 1. Validate environment variables (Zod)
 * 2. Connect to MongoDB
 * 3. Build Fastify app with routes and middleware
 * 4. Connect Kafka producer
 * 5. Start Kafka consumers
 * 6. Start BullMQ workers
 * 7. Start cron schedulers
 * 8. Start HTTP server
 *
 * Graceful shutdown handles all connections and workers.
 *
 * @module index
 */

import Fastify from 'fastify';
import type { FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectProducer, disconnectProducer, ensureTopics } from './config/kafka.js';
import { disconnectRedis } from './config/redis.js';
import { authMiddleware, tenancyMiddleware } from './api/middleware/index.js';
import {
  flowRoutes,
  contactRoutes,
  templateRoutes,
  tagRoutes,
  customFieldRoutes,
  analyticsRoutes,
  campaignRoutes,
  systemRoutes,
  trackingRoutes,
  eventRoutes,
} from './api/routes/index.js';
import {
  OrderEventConsumer,
  CustomerEventConsumer,
  CartEventConsumer,
  CRMEventConsumer,
  abandonedCartQueue,
} from './kafka/index.js';
import {
  FlowTimerProcessor,
  AbandonedCartProcessor,
  InactivityChecker,
  LifecycleUpdater,
  ReviewRequestScheduler,
  DateFieldTrigger,
} from './schedulers/index.js';

const log = logger.child({ module: 'bootstrap' });

// ── Fastify App ──

function buildApp() {
  const app = Fastify({
    logger: false, // We use our own Pino logger
    trustProxy: true,
  });

  // Global error handler for Zod validation errors
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    if (error.validation) {
      return reply.code(400).send({
        error: 'Validation Error',
        details: error.validation,
      });
    }
    // Zod errors thrown manually
    if (error.name === 'ZodError') {
      return reply.code(400).send({
        error: 'Validation Error',
        details: (error as any).issues,
      });
    }
    // Mongoose validation errors
    if (error.name === 'ValidationError') {
      return reply.code(400).send({
        error: 'Validation Error',
        message: error.message,
      });
    }
    // MongoDB duplicate key error
    if ((error as any).code === 11000) {
      const keyValue = (error as any).keyValue ?? {};
      const field = Object.keys(keyValue)[0] ?? 'field';
      return reply.code(409).send({
        error: 'Duplicate Entry',
        message: `A record with that ${field} already exists`,
        field,
      });
    }
    log.error({ err: error }, 'Unhandled error');
    return reply.code(error.statusCode ?? 500).send({
      error: error.message ?? 'Internal Server Error',
    });
  });

  // ── Auth + Tenancy middleware (applied to /api/* routes) ──
  app.addHook('preHandler', async (request, reply) => {
    // Skip auth for health check and tracking routes
    const routeConfig = ((request.routeOptions?.config as any) ?? {}) as Record<string, unknown>;
    if (routeConfig.skipAuth) return;

    // Only apply to /api/* routes
    if (!request.url.startsWith('/api/')) return;

    await authMiddleware(request, reply);
    if (reply.sent) return;
    await tenancyMiddleware(request, reply);
  });

  // ── Routes ──

  // Public routes (no auth)
  app.register(trackingRoutes);
  app.register(systemRoutes, { prefix: '/api/v1' });

  // Protected routes
  app.register(flowRoutes, { prefix: '/api/v1/flows' });
  app.register(contactRoutes, { prefix: '/api/v1/contacts' });
  app.register(templateRoutes, { prefix: '/api/v1/templates' });
  app.register(tagRoutes, { prefix: '/api/v1/tags' });
  app.register(customFieldRoutes, { prefix: '/api/v1/custom-fields' });
  app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  app.register(campaignRoutes, { prefix: '/api/v1/campaigns' });
  app.register(eventRoutes, { prefix: '/api/v1/events' });

  return app;
}

// ── Bootstrap ──

async function main(): Promise<void> {
  log.info('Starting oc-crm-engine...');

  // 1. Connect to MongoDB
  await connectDatabase();
  log.info('MongoDB connected');

  // Log email provider configuration for diagnostics
  log.info(
    {
      emailProvider: process.env.EMAIL_PROVIDER,
      emailDomain: process.env.EMAIL_DOMAIN,
      emailFrom: process.env.EMAIL_FROM_ADDRESS,
    },
    'Email provider initialized',
  );

  // 2. Build Fastify app
  const app = buildApp();

  // 3. Connect Kafka producer + ensure topics exist
  if (env.ENABLE_KAFKA) {
    await connectProducer();
    log.info('Kafka producer connected');
    await ensureTopics();
    log.info('Kafka topics ensured');
  }

  // 4. Start Kafka consumers
  const consumers: Array<{ stop: () => Promise<void> }> = [];

  if (env.ENABLE_KAFKA) {
    const orderConsumer = new OrderEventConsumer();
    const customerConsumer = new CustomerEventConsumer();
    const cartConsumer = new CartEventConsumer();
    const crmConsumer = new CRMEventConsumer();

    await orderConsumer.start();
    await customerConsumer.start();
    await cartConsumer.start();
    await crmConsumer.start();

    consumers.push(orderConsumer, customerConsumer, cartConsumer, crmConsumer);
    log.info('Kafka consumers started');
  }

  // 5. Start BullMQ workers and queues
  const timerProcessor = new FlowTimerProcessor();
  const abandonedCartProcessor = new AbandonedCartProcessor();
  if (env.ENABLE_SCHEDULERS) {
    timerProcessor.start();
    log.info('BullMQ flow timer processor started');

    // Abandoned cart queue is initialized as a module-level singleton in CartEventConsumer.
    // The queue (producer side) is ready when the module loads.
    if (abandonedCartQueue) {
      log.info('Abandoned cart delayed trigger queue ready');
    } else {
      log.warn('Abandoned cart queue not available — Redis disabled');
    }

    // Start the worker that processes delayed abandoned cart jobs
    abandonedCartProcessor.start();
    log.info('BullMQ abandoned cart processor started');
  } else {
    log.info('BullMQ workers skipped (ENABLE_SCHEDULERS=false)');
  }

  // 6. Start cron schedulers
  const schedulers: Array<{ stop: () => void }> = [];

  if (env.ENABLE_SCHEDULERS) {
    const inactivityChecker = new InactivityChecker();
    const lifecycleUpdater = new LifecycleUpdater();
    const reviewScheduler = new ReviewRequestScheduler();
    const dateFieldTrigger = new DateFieldTrigger();

    inactivityChecker.start();
    lifecycleUpdater.start();
    reviewScheduler.start();
    dateFieldTrigger.start();

    schedulers.push(inactivityChecker, lifecycleUpdater, reviewScheduler, dateFieldTrigger);
    log.info('Cron schedulers started');
  }

  // 7. Start HTTP server
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  log.info({ port: env.PORT }, 'HTTP server listening');

  // ── Graceful Shutdown ──
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutdown signal received');

    // Stop HTTP server
    await app.close();
    log.info('HTTP server closed');

    // Stop schedulers
    for (const scheduler of schedulers) {
      scheduler.stop();
    }

    // Stop BullMQ workers
    await timerProcessor.stop();
    await abandonedCartProcessor.stop();

    // Stop Kafka consumers
    for (const consumer of consumers) {
      await consumer.stop();
    }

    // Disconnect Kafka producer
    if (env.ENABLE_KAFKA) {
      await disconnectProducer();
    }

    // Disconnect Redis
    await disconnectRedis();

    // Disconnect MongoDB
    await disconnectDatabase();

    log.info('Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.fatal({ err }, 'Failed to start oc-crm-engine');
  process.exit(1);
});
