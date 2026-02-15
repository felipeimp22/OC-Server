/**
 * @fileoverview Flow routes — /api/v1/flows
 *
 * @module api/routes/flows
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FlowService } from '../../services/FlowService.js';
import { AnalyticsService } from '../../services/AnalyticsService.js';
import { FlowExecutionRepository } from '../../repositories/FlowExecutionRepository.js';
import { FLOW_TEMPLATES } from '../../seeds/seed.js';
import {
  createFlowBody,
  updateFlowBody,
  idParam,
  paginationQuery,
} from '../validators/index.js';

export async function flowRoutes(app: FastifyInstance): Promise<void> {
  const flowService = new FlowService();
  const analyticsService = new AnalyticsService();
  const executionRepo = new FlowExecutionRepository();

  // GET /api/v1/flows/templates — List flow templates (static)
  app.get('/templates', async () => {
    return FLOW_TEMPLATES.map((t, index) => ({
      key: `template_${index}`,
      name: t.name,
      description: t.description,
      nodeCount: t.nodes.length,
      edgeCount: t.edges.length,
    }));
  });

  // POST /api/v1/flows/from-template — Create flow from a template
  app.post('/from-template', async (request: FastifyRequest, reply: FastifyReply) => {
    const { templateKey, name } = (request.body as { templateKey: string; name?: string });
    const index = parseInt(templateKey.replace('template_', ''), 10);
    const template = FLOW_TEMPLATES[index];
    if (!template) return reply.code(404).send({ error: 'Template not found' });

    const flow = await flowService.create(request.restaurantId, {
      name: name ?? template.name,
      description: template.description,
      nodes: template.nodes.map((n) => ({
        ...n,
        label: n.subType,
        position: { x: 0, y: 0 },
      })) as any,
      edges: template.edges as any,
    });
    return reply.code(201).send(flow);
  });

  // GET /api/v1/flows — List flows
  app.get('/', async (request: FastifyRequest) => {
    const query = paginationQuery.parse(request.query);
    const result = await flowService.list(request.restaurantId, {}, {
      page: query.page,
      limit: query.limit,
      sortBy: query.sort,
      sortOrder: query.order,
    });
    return result;
  });

  // GET /api/v1/flows/:id — Get flow detail
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const flow = await flowService.getById(request.restaurantId, id);
    if (!flow) return reply.code(404).send({ error: 'Flow not found' });
    return flow;
  });

  // POST /api/v1/flows — Create flow
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createFlowBody.parse(request.body);
    const flow = await flowService.create(request.restaurantId, body as any);
    return reply.code(201).send(flow);
  });

  // PUT /api/v1/flows/:id — Update flow
  app.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const body = updateFlowBody.parse(request.body);
    const flow = await flowService.update(request.restaurantId, id, body as any);
    if (!flow) return reply.code(404).send({ error: 'Flow not found' });
    return flow;
  });

  // DELETE /api/v1/flows/:id — Delete flow
  app.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const deleted = await flowService.delete(request.restaurantId, id);
    if (!deleted) return reply.code(404).send({ error: 'Flow not found' });
    return { success: true };
  });

  // POST /api/v1/flows/:id/activate — Activate flow
  app.post('/:id/activate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    try {
      const flow = await flowService.activate(request.restaurantId, id);
      if (!flow) return reply.code(404).send({ error: 'Flow not found' });
      return flow;
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // POST /api/v1/flows/:id/pause — Pause flow
  app.post('/:id/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParam.parse(request.params);
    const flow = await flowService.pause(request.restaurantId, id);
    if (!flow) return reply.code(404).send({ error: 'Flow not found' });
    return flow;
  });

  // GET /api/v1/flows/:id/executions — List enrollments
  app.get('/:id/executions', async (request: FastifyRequest) => {
    const { id } = idParam.parse(request.params);
    const query = paginationQuery.parse(request.query);
    const result = await executionRepo.findPaginated(request.restaurantId, { flowId: id }, {
      page: query.page,
      limit: query.limit,
    });
    return result;
  });

  // GET /api/v1/flows/:id/analytics — Flow analytics
  app.get('/:id/analytics', async (request: FastifyRequest) => {
    const { id } = idParam.parse(request.params);
    const analytics = await analyticsService.getFlowAnalytics(id);
    return analytics;
  });
}
