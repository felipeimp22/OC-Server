/**
 * @fileoverview Route tests for US-016 — REST API Flows
 *
 * Verifies all flow endpoints: CRUD, activate/pause, executions, analytics.
 * Uses Fastify inject to test HTTP behaviour without a real server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/config/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/config/env.js', () => ({
  env: {
    AUTH_SECRET: 'test-secret-for-jwt',
    NODE_ENV: 'test',
    ENABLE_KAFKA: false,
    ENABLE_SCHEDULERS: false,
  },
}));

const mockFlowService = {
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  activate: vi.fn(),
  pause: vi.fn(),
};

vi.mock('@/services/FlowService.js', () => ({
  FlowService: vi.fn(() => mockFlowService),
}));

const mockAnalyticsService = {
  getFlowAnalytics: vi.fn(),
};

vi.mock('@/services/AnalyticsService.js', () => ({
  AnalyticsService: vi.fn(() => mockAnalyticsService),
}));

const mockExecutionRepo = {
  findPaginated: vi.fn(),
  findOne: vi.fn(),
  advanceToNode: vi.fn(),
  markError: vi.fn(),
};

vi.mock('@/repositories/FlowExecutionRepository.js', () => ({
  FlowExecutionRepository: vi.fn(() => mockExecutionRepo),
}));

vi.mock('@/seeds/seed.js', () => ({
  FLOW_TEMPLATES: [
    {
      name: 'Welcome Flow',
      description: 'A welcome sequence',
      nodes: [
        { id: 'n1', type: 'trigger', subType: 'order_completed', config: {} },
        { id: 'n2', type: 'action', subType: 'send_email', config: {} },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
    },
  ],
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const RESTAURANT_ID = 'rest-123';

/** Build a minimal Fastify app with auth/tenancy stubbed out and flow routes registered. */
async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Mirror the global error handler from index.ts to convert Zod errors → 400
  app.setErrorHandler((error: any, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: 'Validation Error', details: error.validation });
    }
    if (error.name === 'ZodError') {
      return reply.code(400).send({ error: 'Validation Error', details: error.issues });
    }
    return reply.code(error.statusCode ?? 500).send({ error: error.message ?? 'Internal Server Error' });
  });

  // Stub auth+tenancy: inject restaurantId directly
  app.addHook('preHandler', async (request) => {
    (request as any).user = { id: 'user-1', email: 'test@example.com' };
    (request as any).restaurantId = RESTAURANT_ID;
  });

  const { flowRoutes } = await import('@/api/routes/flows.js');
  await app.register(flowRoutes, { prefix: '/api/v1/flows' });

  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('US-016: REST API — Flows', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  // ── GET /api/v1/flows/templates ──────────────────────────────────────────

  describe('GET /api/v1/flows/templates', () => {
    it('returns static template catalog with key, name, description, nodeCount, edgeCount', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/flows/templates' });

      expect(res.statusCode).toBe(200);
      const body = res.json<any[]>();
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toMatchObject({
        key: 'template_0',
        name: 'Welcome Flow',
        description: 'A welcome sequence',
        nodeCount: 2,
        edgeCount: 1,
      });
    });
  });

  // ── POST /api/v1/flows/from-template ────────────────────────────────────

  describe('POST /api/v1/flows/from-template', () => {
    it('creates flow from a valid template key and returns 201', async () => {
      const created = { _id: 'flow-new', name: 'Welcome Flow', status: 'draft' };
      mockFlowService.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/flows/from-template',
        payload: { templateKey: 'template_0' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ _id: 'flow-new', name: 'Welcome Flow' });
      expect(mockFlowService.create).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.objectContaining({ name: 'Welcome Flow' }),
      );
    });

    it('creates flow with custom name when provided', async () => {
      const created = { _id: 'flow-new', name: 'Custom Name', status: 'draft' };
      mockFlowService.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/flows/from-template',
        payload: { templateKey: 'template_0', name: 'Custom Name' },
      });

      expect(res.statusCode).toBe(201);
      expect(mockFlowService.create).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.objectContaining({ name: 'Custom Name' }),
      );
    });

    it('returns 404 for unknown template key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/flows/from-template',
        payload: { templateKey: 'template_999' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/v1/flows ────────────────────────────────────────────────────

  describe('GET /api/v1/flows', () => {
    it('returns paginated result with data, total, page, limit, totalPages, hasMore', async () => {
      const paginated = {
        data: [{ _id: 'f1', name: 'Flow 1', status: 'active' }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasMore: false,
      };
      mockFlowService.list.mockResolvedValue(paginated);

      const res = await app.inject({ method: 'GET', url: '/api/v1/flows' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ data: expect.any(Array), total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false });
    });

    it('filters by ?status= query param', async () => {
      mockFlowService.list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0, hasMore: false });

      const res = await app.inject({ method: 'GET', url: '/api/v1/flows?status=active' });

      expect(res.statusCode).toBe(200);
      expect(mockFlowService.list).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.objectContaining({ status: 'active' }),
        expect.any(Object),
      );
    });

    it('accepts ?page= and ?limit= query params', async () => {
      mockFlowService.list.mockResolvedValue({ data: [], total: 0, page: 2, limit: 5, totalPages: 0, hasMore: false });

      const res = await app.inject({ method: 'GET', url: '/api/v1/flows?page=2&limit=5' });

      expect(res.statusCode).toBe(200);
      expect(mockFlowService.list).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.any(Object),
        expect.objectContaining({ page: 2, limit: 5 }),
      );
    });
  });

  // ── GET /api/v1/flows/:id ────────────────────────────────────────────────

  describe('GET /api/v1/flows/:id', () => {
    it('returns 200 with flow when found', async () => {
      const flow = { _id: 'flow-1', name: 'Test', status: 'draft' };
      mockFlowService.getById.mockResolvedValue(flow);

      const res = await app.inject({ method: 'GET', url: '/api/v1/flows/flow-1' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ _id: 'flow-1' });
      expect(mockFlowService.getById).toHaveBeenCalledWith(RESTAURANT_ID, 'flow-1');
    });

    it('returns 404 when flow not found or wrong tenant', async () => {
      mockFlowService.getById.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/api/v1/flows/nonexistent' });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/v1/flows ───────────────────────────────────────────────────

  describe('POST /api/v1/flows', () => {
    it('creates a flow and returns 201', async () => {
      const created = { _id: 'f-new', name: 'My Flow', status: 'draft' };
      mockFlowService.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/flows',
        payload: { name: 'My Flow' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ _id: 'f-new' });
    });

    it('returns 400 when name is missing (Zod validation)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/flows',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when name is empty string (Zod validation)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/flows',
        payload: { name: '' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('accepts nodes[] and edges[] in the payload', async () => {
      const created = { _id: 'f-new', name: 'Flow with nodes', status: 'draft' };
      mockFlowService.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/flows',
        payload: {
          name: 'Flow with nodes',
          nodes: [{ id: 'n1', type: 'trigger', subType: 'order_completed' }],
          edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
        },
      });

      expect(res.statusCode).toBe(201);
    });

    it('returns 400 for invalid node type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/flows',
        payload: {
          name: 'Bad Flow',
          nodes: [{ id: 'n1', type: 'invalid_type', subType: 'test' }],
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── PUT /api/v1/flows/:id ────────────────────────────────────────────────

  describe('PUT /api/v1/flows/:id', () => {
    it('updates a draft flow and returns 200', async () => {
      const updated = { _id: 'f1', name: 'Updated Name', status: 'draft' };
      mockFlowService.update.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/flows/f1',
        payload: { name: 'Updated Name' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Updated Name' });
    });

    it('returns 400 when updating an active flow (must pause first)', async () => {
      mockFlowService.update.mockRejectedValue(new Error('Cannot update an active flow. Pause it first.'));

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/flows/f1',
        payload: { name: 'New Name' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('active flow') });
    });

    it('returns 404 when flow not found', async () => {
      mockFlowService.update.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/flows/nonexistent',
        payload: { name: 'New Name' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/v1/flows/:id ─────────────────────────────────────────────

  describe('DELETE /api/v1/flows/:id', () => {
    it('deletes a flow and returns 200 with success true', async () => {
      mockFlowService.delete.mockResolvedValue(true);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/flows/f1' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true });
    });

    it('returns 400 when trying to delete a system flow', async () => {
      mockFlowService.delete.mockRejectedValue(new Error('System flows cannot be deleted'));

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/flows/system-flow' });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('System flows') });
    });

    it('returns 404 when flow not found', async () => {
      mockFlowService.delete.mockResolvedValue(false);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/flows/nonexistent' });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/v1/flows/:id/activate ──────────────────────────────────────

  describe('POST /api/v1/flows/:id/activate', () => {
    it('activates a valid flow and returns 200 with updated flow', async () => {
      const activated = { _id: 'f1', name: 'Flow', status: 'active' };
      mockFlowService.activate.mockResolvedValue(activated);

      const res = await app.inject({ method: 'POST', url: '/api/v1/flows/f1/activate' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'active' });
    });

    it('returns 400 when flow is missing trigger or action nodes', async () => {
      mockFlowService.activate.mockRejectedValue(
        new Error('Flow must have at least one trigger node'),
      );

      const res = await app.inject({ method: 'POST', url: '/api/v1/flows/f1/activate' });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('trigger') });
    });

    it('returns 404 when flow not found', async () => {
      mockFlowService.activate.mockResolvedValue(null);

      const res = await app.inject({ method: 'POST', url: '/api/v1/flows/nonexistent/activate' });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/v1/flows/:id/pause ─────────────────────────────────────────

  describe('POST /api/v1/flows/:id/pause', () => {
    it('pauses a flow and returns 200 with updated flow', async () => {
      const paused = { _id: 'f1', name: 'Flow', status: 'paused' };
      mockFlowService.pause.mockResolvedValue(paused);

      const res = await app.inject({ method: 'POST', url: '/api/v1/flows/f1/pause' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'paused' });
    });

    it('returns 404 when flow not found', async () => {
      mockFlowService.pause.mockResolvedValue(null);

      const res = await app.inject({ method: 'POST', url: '/api/v1/flows/nonexistent/pause' });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/v1/flows/:id/executions ─────────────────────────────────────

  describe('GET /api/v1/flows/:id/executions', () => {
    it('returns paginated list of FlowExecution documents', async () => {
      const paginated = {
        data: [{ _id: 'exec-1', flowId: 'f1', status: 'completed' }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasMore: false,
      };
      mockExecutionRepo.findPaginated.mockResolvedValue(paginated);

      const res = await app.inject({ method: 'GET', url: '/api/v1/flows/f1/executions' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ data: expect.any(Array), total: 1 });
      expect(mockExecutionRepo.findPaginated).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.objectContaining({ flowId: 'f1' }),
        expect.any(Object),
      );
    });
  });

  // ── GET /api/v1/flows/:id/analytics ──────────────────────────────────────

  describe('GET /api/v1/flows/:id/analytics', () => {
    it('returns FlowNodeAnalytics[]', async () => {
      const analytics = [
        { nodeId: 'n1', nodeType: 'trigger', success: 10, failure: 0, skipped: 0, total: 10 },
        { nodeId: 'n2', nodeType: 'action', success: 8, failure: 2, skipped: 0, total: 10 },
      ];
      mockAnalyticsService.getFlowAnalytics.mockResolvedValue(analytics);

      const res = await app.inject({ method: 'GET', url: '/api/v1/flows/f1/analytics' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(analytics);
      expect(mockAnalyticsService.getFlowAnalytics).toHaveBeenCalledWith('f1');
    });
  });
});
