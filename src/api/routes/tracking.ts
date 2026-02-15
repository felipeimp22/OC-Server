/**
 * @fileoverview Link tracking redirect route — /t/:trackingId
 *
 * @module api/routes/tracking
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CommunicationService } from '../../services/CommunicationService.js';

export async function trackingRoutes(app: FastifyInstance): Promise<void> {
  const commService = new CommunicationService();

  // GET /t/:trackingId — Redirect tracked link click
  app.get('/t/:trackingId', { config: { skipAuth: true } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { trackingId } = request.params as { trackingId: string };
    const trackingUrl = `/t/${trackingId}`;

    const originalUrl = await commService.recordLinkClick(trackingUrl);
    if (!originalUrl) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return reply.redirect(originalUrl);
  });
}
