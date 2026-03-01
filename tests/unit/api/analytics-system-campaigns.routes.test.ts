/**
 * @fileoverview Route tests for US-018 — REST API Analytics, System, Campaigns
 *
 * Verifies all analytics, system utility, and campaign endpoints.
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

let mockEnableKafka = false;

vi.mock('@/config/env.js', () => ({
  get env() {
    return {
      AUTH_SECRET: 'test-secret-for-jwt',
      NODE_ENV: 'test',
      get ENABLE_KAFKA() {
        return mockEnableKafka;
      },
      ENABLE_SCHEDULERS: false,
    };
  },
}));

// ── Analytics Service Mock ──────────────────────────────────────────────────

const mockAnalyticsService = {
  getDashboardOverview: vi.fn(),
  getFlowAnalytics: vi.fn(),
  getMessagingStats: vi.fn(),
};

vi.mock('@/services/AnalyticsService.js', () => ({
  AnalyticsService: vi.fn(() => mockAnalyticsService),
}));

// ── Campaign Service Mock ───────────────────────────────────────────────────

const mockCampaignService = {
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/services/CampaignService.js', () => ({
  CampaignService: vi.fn(() => mockCampaignService),
}));

// ── Contact Service Mock ────────────────────────────────────────────────────

const mockContactService = {
  upsertFromCustomer: vi.fn(),
};

vi.mock('@/services/ContactService.js', () => ({
  ContactService: vi.fn(() => mockContactService),
}));

// ── CommunicationService Mock (used by system routes test-email) ────────────

vi.mock('@/services/CommunicationService.js', () => ({
  CommunicationService: vi.fn(() => ({
    sendEmail: vi.fn(),
  })),
}));

// ── Customer Model Mock ─────────────────────────────────────────────────────

const mockCustomers = [
  { _id: 'cust-1', name: 'Alice', email: 'alice@example.com', phone: null },
  { _id: 'cust-2', name: 'Bob', email: 'bob@example.com', phone: '+1234567890' },
];

vi.mock('@/domain/models/external/Customer.js', () => ({
  Customer: {
    find: vi.fn(() => ({
      lean: vi.fn(() => ({
        exec: vi.fn().mockResolvedValue(mockCustomers),
      })),
    })),
  },
}));

// ── Mongoose Mock (for health check) ───────────────────────────────────────

vi.mock('mongoose', () => ({
  default: {
    connection: { readyState: 1 },
  },
}));

// ── Kafka Topics Mock ───────────────────────────────────────────────────────

vi.mock('@/kafka/topics.js', () => ({
  KAFKA_TOPICS: {
    ORDERCHOP_ORDERS: 'orderchop.orders',
    ORDERCHOP_PAYMENTS: 'orderchop.payments',
    ORDERCHOP_CUSTOMERS: 'orderchop.customers',
    ORDERCHOP_CARTS: 'orderchop.carts',
    CRM_FLOW_EXECUTE: 'crm.flow.execute',
    CRM_CONTACTS: 'crm.contacts',
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const RESTAURANT_ID = 'rest-123';

function buildErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: any, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: 'Validation Error', details: error.validation });
    }
    if (error.name === 'ZodError') {
      return reply.code(400).send({ error: 'Validation Error', details: error.issues });
    }
    return reply.code(error.statusCode ?? 500).send({ error: error.message ?? 'Internal Server Error' });
  });
}

function addAuthStub(app: FastifyInstance): void {
  app.addHook('preHandler', async (request) => {
    (request as any).user = { id: 'user-1', email: 'test@example.com' };
    (request as any).restaurantId = RESTAURANT_ID;
  });
}

async function buildAnalyticsApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  buildErrorHandler(app);
  addAuthStub(app);
  const { analyticsRoutes } = await import('@/api/routes/analytics.js');
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  return app;
}

async function buildSystemApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  buildErrorHandler(app);
  // Only add auth stub for non-health routes; the system routes handler checks skipAuth internally
  app.addHook('preHandler', async (request) => {
    // Skip auth stub for /health (mirrors real app behaviour)
    if (!request.url.includes('/health')) {
      (request as any).user = { id: 'user-1', email: 'test@example.com' };
      (request as any).restaurantId = RESTAURANT_ID;
    }
  });
  const { systemRoutes } = await import('@/api/routes/system.js');
  await app.register(systemRoutes, { prefix: '/api/v1' });
  return app;
}

async function buildCampaignsApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  buildErrorHandler(app);
  addAuthStub(app);
  const { campaignRoutes } = await import('@/api/routes/campaigns.js');
  await app.register(campaignRoutes, { prefix: '/api/v1/campaigns' });
  return app;
}

// ── Analytics Tests ────────────────────────────────────────────────────────

describe('US-018: REST API — Analytics', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildAnalyticsApp();
  });

  describe('GET /api/v1/analytics/overview', () => {
    it('returns DashboardOverview shape', async () => {
      const overview = {
        totalContacts: 100,
        newContactsThisMonth: 12,
        segments: { lead: 30, first_time: 20, returning: 25, lost: 10, recovered: 5, VIP: 10 },
        activeFlows: 3,
        totalEnrollments: 450,
        messagingStats: [{ channel: 'email', status: 'sent', count: 200 }],
      };
      mockAnalyticsService.getDashboardOverview.mockResolvedValue(overview);

      const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/overview' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        totalContacts: 100,
        newContactsThisMonth: 12,
        segments: expect.any(Object),
        activeFlows: 3,
        totalEnrollments: 450,
        messagingStats: expect.any(Array),
      });
      expect(mockAnalyticsService.getDashboardOverview).toHaveBeenCalledWith(RESTAURANT_ID);
    });

    it('passes restaurantId from tenancy middleware', async () => {
      mockAnalyticsService.getDashboardOverview.mockResolvedValue({});
      await app.inject({ method: 'GET', url: '/api/v1/analytics/overview' });
      expect(mockAnalyticsService.getDashboardOverview).toHaveBeenCalledWith(RESTAURANT_ID);
    });
  });

  describe('GET /api/v1/analytics/messaging', () => {
    it('returns MessagingStat[] without since param', async () => {
      const stats = [
        { channel: 'email', status: 'sent', count: 150 },
        { channel: 'sms', status: 'skipped', count: 30 },
      ];
      mockAnalyticsService.getMessagingStats.mockResolvedValue(stats);

      const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/messaging' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual(stats);
      expect(mockAnalyticsService.getMessagingStats).toHaveBeenCalledWith(RESTAURANT_ID, undefined);
    });

    it('passes since as Date when ?since= ISO param provided', async () => {
      mockAnalyticsService.getMessagingStats.mockResolvedValue([]);
      const since = '2026-01-01T00:00:00.000Z';

      await app.inject({ method: 'GET', url: `/api/v1/analytics/messaging?since=${since}` });

      expect(mockAnalyticsService.getMessagingStats).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.any(Date),
      );
      const callArgs = mockAnalyticsService.getMessagingStats.mock.calls[0];
      expect((callArgs[1] as Date).toISOString()).toBe(since);
    });
  });

  describe('GET /api/v1/analytics/flows/:id', () => {
    it('returns FlowNodeAnalytics[] for a flow', async () => {
      const nodeStats = [
        { nodeId: 'n1', nodeType: 'trigger', success: 50, failure: 0, skipped: 0, total: 50 },
        { nodeId: 'n2', nodeType: 'action', success: 45, failure: 5, skipped: 0, total: 50 },
      ];
      mockAnalyticsService.getFlowAnalytics.mockResolvedValue(nodeStats);

      const res = await app.inject({ method: 'GET', url: '/api/v1/analytics/flows/flow-abc' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual(nodeStats);
      expect(mockAnalyticsService.getFlowAnalytics).toHaveBeenCalledWith('flow-abc');
    });
  });
});

// ── System Tests ───────────────────────────────────────────────────────────

describe('US-018: REST API — System', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEnableKafka = false;
    app = await buildSystemApp();
  });

  describe('GET /api/v1/health', () => {
    it('returns { status: ok, mongodb: connected, uptime, timestamp } without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.mongodb).toBe('connected');
      expect(typeof body.uptime).toBe('number');
      expect(typeof body.timestamp).toBe('string');
    });
  });

  describe('GET /api/v1/system/kafka-status', () => {
    it('returns { enabled: false } when ENABLE_KAFKA=false', async () => {
      mockEnableKafka = false;

      const res = await app.inject({ method: 'GET', url: '/api/v1/system/kafka-status' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: false });
    });

    it('returns { enabled: true, topics: [...] } when ENABLE_KAFKA=true', async () => {
      mockEnableKafka = true;

      const res = await app.inject({ method: 'GET', url: '/api/v1/system/kafka-status' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.enabled).toBe(true);
      expect(Array.isArray(body.topics)).toBe(true);
      expect(body.topics.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/system/sync-contacts', () => {
    it('reads customers, calls upsertFromCustomer for each, returns { synced, total }', async () => {
      mockContactService.upsertFromCustomer.mockResolvedValue({});

      const res = await app.inject({ method: 'POST', url: '/api/v1/system/sync-contacts' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ synced: 2, total: 2 });
      expect(mockContactService.upsertFromCustomer).toHaveBeenCalledTimes(2);
      expect(mockContactService.upsertFromCustomer).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.objectContaining({ customerId: 'cust-1', email: 'alice@example.com' }),
      );
    });

    it('counts only successful syncs (skips failures)', async () => {
      mockContactService.upsertFromCustomer
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('DB error'));

      const res = await app.inject({ method: 'POST', url: '/api/v1/system/sync-contacts' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ synced: 1, total: 2 });
    });
  });
});

// ── Campaigns Tests ────────────────────────────────────────────────────────

describe('US-018: REST API — Campaigns', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildCampaignsApp();
  });

  describe('GET /api/v1/campaigns', () => {
    it('returns paginated campaigns with restaurantId isolation', async () => {
      const paginated = {
        data: [{ _id: 'camp-1', name: 'Summer Promo', restaurantId: RESTAURANT_ID }],
        total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false,
      };
      mockCampaignService.list.mockResolvedValue(paginated);

      const res = await app.inject({ method: 'GET', url: '/api/v1/campaigns' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ data: expect.any(Array), total: 1 });
      expect(mockCampaignService.list).toHaveBeenCalledWith(
        RESTAURANT_ID,
        {},
        expect.objectContaining({ page: 1, limit: 20 }),
      );
    });

    it('respects ?page= and ?limit= query params', async () => {
      mockCampaignService.list.mockResolvedValue({ data: [], total: 0, page: 2, limit: 5, totalPages: 0, hasMore: false });

      await app.inject({ method: 'GET', url: '/api/v1/campaigns?page=2&limit=5' });

      expect(mockCampaignService.list).toHaveBeenCalledWith(
        RESTAURANT_ID,
        {},
        expect.objectContaining({ page: 2, limit: 5 }),
      );
    });
  });

  describe('GET /api/v1/campaigns/:id', () => {
    it('returns a campaign when found', async () => {
      const campaign = { _id: 'camp-1', name: 'Summer Promo', restaurantId: RESTAURANT_ID };
      mockCampaignService.getById.mockResolvedValue(campaign);

      const res = await app.inject({ method: 'GET', url: '/api/v1/campaigns/camp-1' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Summer Promo' });
      expect(mockCampaignService.getById).toHaveBeenCalledWith(RESTAURANT_ID, 'camp-1');
    });

    it('returns 404 when campaign not found', async () => {
      mockCampaignService.getById.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/api/v1/campaigns/nonexistent' });

      expect(res.statusCode).toBe(404);
    });

    it('is tenant-isolated: passes restaurantId to service', async () => {
      mockCampaignService.getById.mockResolvedValue(null);
      await app.inject({ method: 'GET', url: '/api/v1/campaigns/camp-1' });
      expect(mockCampaignService.getById).toHaveBeenCalledWith(RESTAURANT_ID, 'camp-1');
    });
  });

  describe('POST /api/v1/campaigns', () => {
    it('creates a campaign and returns 201', async () => {
      const created = { _id: 'camp-new', name: 'Black Friday', restaurantId: RESTAURANT_ID };
      mockCampaignService.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { name: 'Black Friday', description: 'Fall promotion', flowIds: ['flow-1'] },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: 'Black Friday' });
      expect(mockCampaignService.create).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.objectContaining({ name: 'Black Friday' }),
      );
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/campaigns',
        payload: { description: 'No name' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /api/v1/campaigns/:id', () => {
    it('updates a campaign and returns 200', async () => {
      const updated = { _id: 'camp-1', name: 'Updated Promo', restaurantId: RESTAURANT_ID };
      mockCampaignService.update.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/campaigns/camp-1',
        payload: { name: 'Updated Promo' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Updated Promo' });
      expect(mockCampaignService.update).toHaveBeenCalledWith(
        RESTAURANT_ID,
        'camp-1',
        expect.objectContaining({ name: 'Updated Promo' }),
      );
    });

    it('returns 404 when campaign not found', async () => {
      mockCampaignService.update.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/campaigns/nonexistent',
        payload: { name: 'Does Not Exist' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('is tenant-isolated: passes restaurantId to service', async () => {
      mockCampaignService.update.mockResolvedValue({});
      await app.inject({
        method: 'PUT',
        url: '/api/v1/campaigns/camp-1',
        payload: { name: 'Test' },
      });
      expect(mockCampaignService.update).toHaveBeenCalledWith(RESTAURANT_ID, 'camp-1', expect.any(Object));
    });
  });
});
