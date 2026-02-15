/**
 * @fileoverview Contact routes — /api/v1/contacts
 *
 * @module api/routes/contacts
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ContactService } from '../../services/ContactService.js';
import { FlowExecutionLogRepository } from '../../repositories/FlowExecutionLogRepository.js';
import {
  updateContactBody,
  applyTagsBody,
  idParam,
  paginationQuery,
} from '../validators/index.js';

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  const contactService = new ContactService();
  const logRepo = new FlowExecutionLogRepository();

  // GET /api/v1/contacts — List contacts
  app.get('/', async (request: FastifyRequest) => {
    const query = paginationQuery.parse(request.query);
    const { lifecycle, tag, search } = request.query as Record<string, string>;

    const filters: Record<string, unknown> = {};
    if (lifecycle) filters.lifecycleStatus = lifecycle;
    if (tag) filters.tags = tag;
    if (search) {
      filters.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    return contactService.list(request.restaurantId, filters, {
      page: query.page,
      limit: query.limit,
      sortBy: query.sort,
      sortOrder: query.order,
    });
  });

  // GET /api/v1/contacts/segments — Segment counts
  app.get('/segments', async (request: FastifyRequest) => {
    return contactService.getSegmentCounts(request.restaurantId);
  });

  // GET /api/v1/contacts/:id — Contact detail
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const contact = await contactService.getById(request.restaurantId, id);
    if (!contact) return reply.code(404).send({ error: 'Contact not found' });
    return contact;
  });

  // PUT /api/v1/contacts/:id — Update contact
  app.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const body = updateContactBody.parse(request.body);
    const contact = await contactService.update(request.restaurantId, id, body);
    if (!contact) return reply.code(404).send({ error: 'Contact not found' });
    return contact;
  });

  // GET /api/v1/contacts/:id/timeline — Activity timeline
  app.get('/:id/timeline', async (request: FastifyRequest) => {
    const { id } = idParam.parse(request.params);
    const query = paginationQuery.parse(request.query);
    const logs = await logRepo.findByContact(request.restaurantId, id, query.limit);
    return logs;
  });

  // POST /api/v1/contacts/:id/tags — Apply tags
  app.post('/:id/tags', async (request: FastifyRequest) => {
    const { id } = idParam.parse(request.params);
    const { tagIds } = applyTagsBody.parse(request.body);

    for (const tagId of tagIds) {
      await contactService.applyTag(request.restaurantId, id, tagId);
    }

    const contact = await contactService.getById(request.restaurantId, id);
    return contact;
  });

  // DELETE /api/v1/contacts/:id/tags/:tagId — Remove tag
  app.delete('/:id/tags/:tagId', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string; tagId: string };
    const contact = await contactService.removeTag(request.restaurantId, params.id, params.tagId);
    if (!contact) return reply.code(404).send({ error: 'Contact not found' });
    return contact;
  });
}
