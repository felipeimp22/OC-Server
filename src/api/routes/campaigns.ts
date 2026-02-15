/**
 * @fileoverview Campaign routes — /api/v1/campaigns
 *
 * @module api/routes/campaigns
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CampaignService } from '../../services/CampaignService.js';
import {
  createCampaignBody,
  updateCampaignBody,
  idParam,
  paginationQuery,
} from '../validators/index.js';

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  const campaignService = new CampaignService();

  // GET /api/v1/campaigns
  app.get('/', async (request: FastifyRequest) => {
    const query = paginationQuery.parse(request.query);
    return campaignService.list(request.restaurantId, {}, {
      page: query.page,
      limit: query.limit,
    });
  });

  // GET /api/v1/campaigns/:id
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const campaign = await campaignService.getById(request.restaurantId, id);
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });
    return campaign;
  });

  // POST /api/v1/campaigns
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createCampaignBody.parse(request.body);
    const campaign = await campaignService.create(request.restaurantId, body as any);
    return reply.code(201).send(campaign);
  });

  // PUT /api/v1/campaigns/:id
  app.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const body = updateCampaignBody.parse(request.body);
    const campaign = await campaignService.update(request.restaurantId, id, body as any);
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });
    return campaign;
  });
}
