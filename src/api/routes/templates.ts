/**
 * @fileoverview Template routes — /api/v1/templates
 *
 * @module api/routes/templates
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TemplateService } from '../../services/TemplateService.js';
import {
  createTemplateBody,
  updateTemplateBody,
  previewTemplateBody,
  idParam,
  paginationQuery,
} from '../validators/index.js';

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  const templateService = new TemplateService();

  // GET /api/v1/templates
  app.get('/', async (request: FastifyRequest) => {
    const query = paginationQuery.parse(request.query);
    const { channel } = request.query as Record<string, string>;
    const filters: Record<string, unknown> = {};
    if (channel) filters.channel = channel;

    return templateService.list(request.restaurantId, filters, {
      page: query.page,
      limit: query.limit,
    });
  });

  // POST /api/v1/templates
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createTemplateBody.parse(request.body);
    const template = await templateService.create(request.restaurantId, body);
    return reply.code(201).send(template);
  });

  // PUT /api/v1/templates/:id
  app.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const body = updateTemplateBody.parse(request.body);
    const template = await templateService.update(request.restaurantId, id, body);
    if (!template) return reply.code(404).send({ error: 'Template not found' });
    return template;
  });

  // DELETE /api/v1/templates/:id
  app.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const deleted = await templateService.delete(request.restaurantId, id);
    if (!deleted) return reply.code(404).send({ error: 'Template not found' });
    return { success: true };
  });

  // POST /api/v1/templates/:id/preview
  app.post('/:id/preview', async (request: FastifyRequest) => {
    const { id } = idParam.parse(request.params);
    const { sampleData } = previewTemplateBody.parse(request.body);
    const preview = await templateService.preview(request.restaurantId, id, sampleData as any);
    return preview;
  });
}
