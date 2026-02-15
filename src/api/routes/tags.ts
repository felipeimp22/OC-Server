/**
 * @fileoverview Tag routes — /api/v1/tags
 *
 * @module api/routes/tags
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TagRepository } from '../../repositories/TagRepository.js';
import { createTagBody, updateTagBody, idParam, paginationQuery } from '../validators/index.js';

export async function tagRoutes(app: FastifyInstance): Promise<void> {
  const tagRepo = new TagRepository();

  // GET /api/v1/tags
  app.get('/', async (request: FastifyRequest) => {
    const query = paginationQuery.parse(request.query);
    return tagRepo.findPaginated(request.restaurantId, {}, {
      page: query.page,
      limit: query.limit,
      sortBy: 'name',
      sortOrder: 'asc',
    });
  });

  // POST /api/v1/tags
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createTagBody.parse(request.body);
    const tag = await tagRepo.create({
      restaurantId: request.restaurantId,
      ...body,
      isSystem: false,
      contactCount: 0,
    } as any);
    return reply.code(201).send(tag);
  });

  // PUT /api/v1/tags/:id
  app.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const body = updateTagBody.parse(request.body);
    const tag = await tagRepo.updateById(request.restaurantId, id, { $set: body });
    if (!tag) return reply.code(404).send({ error: 'Tag not found' });
    return tag;
  });

  // DELETE /api/v1/tags/:id
  app.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const tag = await tagRepo.findById(request.restaurantId, id);
    if (!tag) return reply.code(404).send({ error: 'Tag not found' });
    if (tag.isSystem) return reply.code(400).send({ error: 'System tags cannot be deleted' });

    await tagRepo.deleteById(request.restaurantId, id);
    return { success: true };
  });
}
