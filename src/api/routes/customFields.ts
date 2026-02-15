/**
 * @fileoverview Custom Field routes — /api/v1/custom-fields
 *
 * @module api/routes/customFields
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CustomFieldRepository } from '../../repositories/CustomFieldRepository.js';
import {
  createCustomFieldBody,
  updateCustomFieldBody,
  idParam,
} from '../validators/index.js';

export async function customFieldRoutes(app: FastifyInstance): Promise<void> {
  const fieldRepo = new CustomFieldRepository();

  // GET /api/v1/custom-fields
  app.get('/', async (request: FastifyRequest) => {
    return fieldRepo.findAllOrdered(request.restaurantId);
  });

  // POST /api/v1/custom-fields
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createCustomFieldBody.parse(request.body);
    const field = await fieldRepo.create({
      restaurantId: request.restaurantId,
      ...body,
    } as any);
    return reply.code(201).send(field);
  });

  // PUT /api/v1/custom-fields/:id
  app.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const body = updateCustomFieldBody.parse(request.body);
    const field = await fieldRepo.updateById(request.restaurantId, id, { $set: body });
    if (!field) return reply.code(404).send({ error: 'Custom field not found' });
    return field;
  });

  // DELETE /api/v1/custom-fields/:id
  app.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const deleted = await fieldRepo.deleteById(request.restaurantId, id);
    if (!deleted) return reply.code(404).send({ error: 'Custom field not found' });
    return { success: true };
  });
}
