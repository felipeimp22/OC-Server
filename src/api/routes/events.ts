/**
 * @fileoverview Event ingestion route — receives CRM events via HTTP from the Next.js app
 * and publishes them to the correct Kafka topic.
 *
 * This is the HTTP bridge for the transactional outbox pattern:
 * oc-restaurant-manager (Next.js) → POST /api/v1/events/ingest → Kafka topic → consumer
 *
 * The endpoint uses a system JWT (with `system: true` claim) instead of the
 * standard auth + tenancy middleware. Restaurant ID is read from the payload or header.
 *
 * @module api/routes/events
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { getProducer } from '../../config/kafka.js';
import { KAFKA_TOPICS } from '../../kafka/topics.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('EventRoutes');

/** Zod schema for the ingest request body */
const ingestBodySchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  payload: z.record(z.unknown()),
});

/**
 * Route an eventType prefix to the appropriate Kafka topic.
 * - order.* → orderchop.orders
 * - payment.* → orderchop.payments
 * - customer.* → orderchop.customers
 * - cart.* → orderchop.carts
 */
function getTopicForEventType(eventType: string): string | null {
  const prefix = eventType.split('.')[0];
  switch (prefix) {
    case 'order':
      return KAFKA_TOPICS.ORDERCHOP_ORDERS;
    case 'payment':
      return KAFKA_TOPICS.ORDERCHOP_PAYMENTS;
    case 'customer':
      return KAFKA_TOPICS.ORDERCHOP_CUSTOMERS;
    case 'cart':
      return KAFKA_TOPICS.ORDERCHOP_CARTS;
    default:
      return null;
  }
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/events/ingest
   *
   * Accepts domain events from the Next.js eventPublisher service.
   * Verifies a system JWT, routes the event to the correct Kafka topic.
   * Restaurant ID comes from X-Restaurant-Id header (sent by deliverEvent) or payload.
   *
   * Returns { ok: true } on success, { ok: false, error: "..." } on failure.
   * When ENABLE_KAFKA=false, returns { ok: true } without publishing.
   */
  app.post(
    '/ingest',
    { config: { skipAuth: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // ── 1. Verify system JWT ──
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ ok: false, error: 'Missing Authorization header' });
      }

      const token = authHeader.slice(7);
      try {
        const secret = new TextEncoder().encode(env.AUTH_SECRET);
        const { payload: jwtPayload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });

        if (!jwtPayload.system) {
          return reply.code(403).send({ ok: false, error: 'Not a system token' });
        }
      } catch {
        return reply.code(401).send({ ok: false, error: 'Invalid or expired token' });
      }

      // ── 2. Validate body ──
      const parsed = ingestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', details: parsed.error.issues });
      }

      const { eventId, eventType, payload } = parsed.data;

      // Determine Kafka topic from event type prefix
      const topic = getTopicForEventType(eventType);
      if (!topic) {
        log.warn({ eventId, eventType }, 'Unknown event type prefix — no Kafka topic mapping');
        return reply.code(400).send({ ok: false, error: `Unknown event type: ${eventType}` });
      }

      // ── 3. Publish to Kafka (or no-op if disabled) ──
      if (!env.ENABLE_KAFKA) {
        log.debug({ eventId, eventType }, 'Kafka disabled — no-op for event ingest');
        return { ok: true };
      }

      try {
        const producer = getProducer();
        const restaurantId = (payload.restaurantId as string | undefined)
          ?? (request.headers['x-restaurant-id'] as string | undefined)
          ?? 'unknown';

        await producer.send({
          topic,
          messages: [
            {
              key: `${restaurantId}:${eventId}`,
              value: JSON.stringify({
                eventId,
                eventType,
                restaurantId,
                payload,
                timestamp: new Date().toISOString(),
              }),
            },
          ],
        });

        log.info({ eventId, eventType, topic, restaurantId }, 'Event published to Kafka');
        return { ok: true };
      } catch (err) {
        log.error({ err, eventId, eventType }, 'Failed to publish event to Kafka');
        return reply.code(500).send({ ok: false, error: 'Failed to publish event' });
      }
    },
  );
}
