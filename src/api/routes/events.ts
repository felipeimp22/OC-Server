/**
 * @fileoverview Event ingestion route — receives CRM events via HTTP from the Next.js app.
 *
 * This endpoint uses a system JWT (with `system: true` claim) instead of the
 * standard auth + tenancy middleware. The Next.js eventPublisher signs these
 * tokens with the shared AUTH_SECRET.
 *
 * Flow: Next.js publishEvent() → POST /api/v1/events/ingest → contact resolution → trigger evaluation
 *
 * @module api/routes/events
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ContactService } from '../../services/ContactService.js';
import { TriggerService } from '../../services/TriggerService.js';
import { tryProcessEvent } from '../../utils/idempotency.js';
import type { ICRMEventPayload } from '../../domain/interfaces/IEvent.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('EventRoutes');

/** Zod schema for the ingest request body */
const ingestBodySchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  payload: z.record(z.unknown()),
});

/**
 * Maps dot-separated event types to underscore format used by TriggerService.
 * e.g. "order.completed" → "order_completed"
 */
function toTriggerType(eventType: string): string {
  return eventType.replace(/\./g, '_');
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  const contactService = new ContactService();
  const triggerService = new TriggerService();

  /**
   * POST /api/v1/events/ingest
   *
   * Accepts events from the Next.js eventPublisher service.
   * Uses skipAuth because system JWTs don't have UserRestaurant records —
   * we verify the JWT manually and check for the `system: true` claim.
   */
  app.post(
    '/ingest',
    { config: { skipAuth: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // ── 1. Verify system JWT ──
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Missing Authorization header' });
      }

      const token = authHeader.slice(7);
      try {
        const secret = new TextEncoder().encode(env.AUTH_SECRET);
        const { payload: jwtPayload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });

        if (!jwtPayload.system) {
          return reply.code(403).send({ error: 'Not a system token' });
        }
      } catch {
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }

      // ── 2. Extract restaurantId from header ──
      const restaurantId = request.headers['x-restaurant-id'] as string | undefined;
      if (!restaurantId) {
        return reply.code(400).send({ error: 'Missing X-Restaurant-Id header' });
      }

      // ── 3. Validate body ──
      const parsed = ingestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues });
      }

      const { eventId, eventType, payload } = parsed.data;

      // ── 4. Idempotency check ──
      const shouldProcess = await tryProcessEvent(eventId, eventType);
      if (!shouldProcess) {
        log.debug({ eventId }, 'Duplicate event — already processed');
        return reply.code(200).send({ success: true, eventId, duplicate: true });
      }

      log.info({ eventId, eventType, restaurantId }, 'Processing HTTP event');

      try {
        await processEvent(contactService, triggerService, restaurantId, eventType, payload);
      } catch (err) {
        log.error({ err, eventId, eventType }, 'Error processing event');
        return reply.code(500).send({ error: 'Event processing failed' });
      }

      return reply.code(200).send({ success: true, eventId });
    },
  );
}

/**
 * Process a single CRM event — resolve contact, update stats, evaluate triggers.
 *
 * This mirrors the logic in OrderEventConsumer / CustomerEventConsumer but works
 * for HTTP-delivered events from the Next.js transactional outbox.
 */
async function processEvent(
  contactService: ContactService,
  triggerService: TriggerService,
  restaurantId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const customerId = payload.customerId as string | undefined;
  const customerEmail = payload.customerEmail as string | undefined;
  const customerName = payload.customerName as string | undefined;

  // ── Resolve or create CRM contact ──
  let contact = customerId
    ? await contactService.getByCustomerId(restaurantId, customerId)
    : null;

  if (!contact && customerId && customerEmail) {
    contact = await contactService.syncFromCustomer(restaurantId, {
      customerId,
      name: customerName ?? '',
      email: customerEmail,
      phone: (payload.customerPhone as { countryCode: string; number: string }) ?? null,
    });
    log.info({ restaurantId, customerId }, 'Auto-created CRM contact from event');
  }

  // customer.created events only need contact sync — already handled above
  if (eventType === 'customer.created') return;

  // All other events require a resolved contact
  if (!contact) {
    log.warn({ restaurantId, customerId, eventType }, 'Cannot resolve contact for event — skipping');
    return;
  }

  const contactId = contact._id.toString();
  const triggerType = toTriggerType(eventType);

  // Build the trigger payload with fields the TriggerService expects
  const orderTotal = typeof payload.orderTotal === 'number'
    ? payload.orderTotal
    : typeof payload.total === 'number'
      ? payload.total
      : undefined;

  const triggerPayload: ICRMEventPayload = {
    ...payload,
    restaurantId,
    orderTotal,
    customerId: customerId ?? '',
  };

  // ── Route by event type ──
  if (eventType === 'order.completed') {
    // Update contact order stats
    const orderTotal = (payload.orderTotal as number) ?? (payload.total as number) ?? 0;
    const updatedContact = await contactService.recordOrder(restaurantId, contactId, orderTotal);

    // Trigger: order_completed
    await triggerService.evaluateTriggers(restaurantId, 'order_completed', contactId, triggerPayload);

    // Trigger: first_order (if this was the customer's very first order)
    if (updatedContact && updatedContact.totalOrders === 1) {
      log.info({ restaurantId, contactId }, 'First order detected — firing first_order trigger');
      await triggerService.evaluateTriggers(restaurantId, 'first_order', contactId, triggerPayload);
    }
  } else {
    // All other event types: evaluate triggers with the mapped type
    await triggerService.evaluateTriggers(restaurantId, triggerType, contactId, triggerPayload);

    // first_order check for payment/order events (contact may already have totalOrders === 1
    // from a prior order.completed or the order was just created)
    const firstOrderEventTypes = ['order.created', 'payment.succeeded', 'payment.status_changed'];
    if (firstOrderEventTypes.includes(eventType) && contact.totalOrders <= 1) {
      log.info({ restaurantId, contactId, eventType }, 'Evaluating first_order trigger for payment/order event');
      await triggerService.evaluateTriggers(restaurantId, 'first_order', contactId, triggerPayload);
    }
  }
}
