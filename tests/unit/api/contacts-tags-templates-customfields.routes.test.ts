/**
 * @fileoverview Route tests for US-017 — REST API Contacts, Tags, Templates, CustomFields
 *
 * Verifies all endpoints: contacts CRUD + tags/timeline, tags CRUD,
 * templates CRUD + preview, custom fields CRUD.
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

// ── Contact Service Mock ────────────────────────────────────────────────────

const mockContactService = {
  list: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  applyTag: vi.fn(),
  removeTag: vi.fn(),
  getSegmentCounts: vi.fn(),
};

vi.mock('@/services/ContactService.js', () => ({
  ContactService: vi.fn(() => mockContactService),
}));

// ── FlowExecutionLog Repo Mock ──────────────────────────────────────────────

const mockLogRepo = {
  findByContact: vi.fn(),
};

vi.mock('@/repositories/FlowExecutionLogRepository.js', () => ({
  FlowExecutionLogRepository: vi.fn(() => mockLogRepo),
}));

// ── Tag Repo Mock ───────────────────────────────────────────────────────────

const mockTagRepo = {
  findPaginated: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  updateById: vi.fn(),
  deleteById: vi.fn(),
};

vi.mock('@/repositories/TagRepository.js', () => ({
  TagRepository: vi.fn(() => mockTagRepo),
}));

// ── Template Service Mock ───────────────────────────────────────────────────

const mockTemplateService = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  preview: vi.fn(),
};

vi.mock('@/services/TemplateService.js', () => ({
  TemplateService: vi.fn(() => mockTemplateService),
}));

// ── CustomField Repo Mock ───────────────────────────────────────────────────

const mockCustomFieldRepo = {
  findAllOrdered: vi.fn(),
  create: vi.fn(),
  updateById: vi.fn(),
  deleteById: vi.fn(),
};

vi.mock('@/repositories/CustomFieldRepository.js', () => ({
  CustomFieldRepository: vi.fn(() => mockCustomFieldRepo),
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

async function buildContactsApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  buildErrorHandler(app);
  addAuthStub(app);
  const { contactRoutes } = await import('@/api/routes/contacts.js');
  await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
  return app;
}

async function buildTagsApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  buildErrorHandler(app);
  addAuthStub(app);
  const { tagRoutes } = await import('@/api/routes/tags.js');
  await app.register(tagRoutes, { prefix: '/api/v1/tags' });
  return app;
}

async function buildTemplatesApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  buildErrorHandler(app);
  addAuthStub(app);
  const { templateRoutes } = await import('@/api/routes/templates.js');
  await app.register(templateRoutes, { prefix: '/api/v1/templates' });
  return app;
}

async function buildCustomFieldsApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  buildErrorHandler(app);
  addAuthStub(app);
  const { customFieldRoutes } = await import('@/api/routes/customFields.js');
  await app.register(customFieldRoutes, { prefix: '/api/v1/custom-fields' });
  return app;
}

// ── Contacts Tests ─────────────────────────────────────────────────────────

describe('US-017: REST API — Contacts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildContactsApp();
  });

  describe('GET /api/v1/contacts', () => {
    it('returns paginated result with data, total, page, limit, totalPages, hasMore', async () => {
      const paginated = {
        data: [{ _id: 'c1', firstName: 'Alice', email: 'alice@example.com', lifecycleStatus: 'lead' }],
        total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false,
      };
      mockContactService.list.mockResolvedValue(paginated);

      const res = await app.inject({ method: 'GET', url: '/api/v1/contacts' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ data: expect.any(Array), total: 1, page: 1 });
      expect(mockContactService.list).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('passes ?search= filter to service', async () => {
      mockContactService.list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0, hasMore: false });

      await app.inject({ method: 'GET', url: '/api/v1/contacts?search=alice' });

      expect(mockContactService.list).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.objectContaining({ $or: expect.any(Array) }),
        expect.any(Object),
      );
    });

    it('passes ?lifecycle= filter to service', async () => {
      mockContactService.list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0, hasMore: false });

      await app.inject({ method: 'GET', url: '/api/v1/contacts?lifecycle=returning' });

      expect(mockContactService.list).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.objectContaining({ lifecycleStatus: 'returning' }),
        expect.any(Object),
      );
    });

    it('passes ?tag= filter to service', async () => {
      mockContactService.list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0, hasMore: false });

      await app.inject({ method: 'GET', url: '/api/v1/contacts?tag=tag-id-123' });

      expect(mockContactService.list).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.objectContaining({ tags: 'tag-id-123' }),
        expect.any(Object),
      );
    });

    it('accepts ?page= and ?limit= query params', async () => {
      mockContactService.list.mockResolvedValue({ data: [], total: 0, page: 2, limit: 10, totalPages: 0, hasMore: false });

      await app.inject({ method: 'GET', url: '/api/v1/contacts?page=2&limit=10' });

      expect(mockContactService.list).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.any(Object),
        expect.objectContaining({ page: 2, limit: 10 }),
      );
    });
  });

  describe('GET /api/v1/contacts/segments', () => {
    it('returns segment counts for all 6 lifecycle statuses', async () => {
      const segments = { lead: 5, first_time: 3, returning: 10, lost: 2, recovered: 1, VIP: 4 };
      mockContactService.getSegmentCounts.mockResolvedValue(segments);

      const res = await app.inject({ method: 'GET', url: '/api/v1/contacts/segments' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ lead: 5, returning: 10, VIP: 4 });
      expect(mockContactService.getSegmentCounts).toHaveBeenCalledWith(RESTAURANT_ID);
    });
  });

  describe('GET /api/v1/contacts/:id', () => {
    it('returns 200 with contact when found', async () => {
      const contact = { _id: 'c1', firstName: 'Alice', restaurantId: RESTAURANT_ID };
      mockContactService.getById.mockResolvedValue(contact);

      const res = await app.inject({ method: 'GET', url: '/api/v1/contacts/c1' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ _id: 'c1', firstName: 'Alice' });
      expect(mockContactService.getById).toHaveBeenCalledWith(RESTAURANT_ID, 'c1');
    });

    it('returns 404 when contact not found or wrong tenant', async () => {
      mockContactService.getById.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/api/v1/contacts/nonexistent' });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/contacts/:id', () => {
    it('updates a contact and returns 200', async () => {
      const updated = { _id: 'c1', firstName: 'Bob', emailOptIn: true };
      mockContactService.update.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/contacts/c1',
        payload: { firstName: 'Bob', emailOptIn: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ firstName: 'Bob' });
    });

    it('expands customFields into dot-notation for merge semantics', async () => {
      const updated = { _id: 'c1', 'customFields.birthday': '1990-01-01' };
      mockContactService.update.mockResolvedValue(updated);

      await app.inject({
        method: 'PUT',
        url: '/api/v1/contacts/c1',
        payload: { customFields: { birthday: '1990-01-01' } },
      });

      expect(mockContactService.update).toHaveBeenCalledWith(
        RESTAURANT_ID,
        'c1',
        expect.objectContaining({ 'customFields.birthday': '1990-01-01' }),
      );
    });

    it('returns 404 when contact not found', async () => {
      mockContactService.update.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/contacts/nonexistent',
        payload: { firstName: 'Bob' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/contacts/:id/timeline', () => {
    it('returns FlowExecutionLog[] sorted by executedAt desc', async () => {
      const logs = [
        { _id: 'log-1', executedAt: new Date().toISOString(), nodeType: 'action', result: 'success' },
      ];
      mockLogRepo.findByContact.mockResolvedValue(logs);

      const res = await app.inject({ method: 'GET', url: '/api/v1/contacts/c1/timeline' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(logs);
      expect(mockLogRepo.findByContact).toHaveBeenCalledWith(RESTAURANT_ID, 'c1', expect.any(Number));
    });
  });

  describe('POST /api/v1/contacts/:id/tags', () => {
    it('applies tags and returns updated contact', async () => {
      const contact = { _id: 'c1', tags: ['tag-1', 'tag-2'] };
      mockContactService.applyTag.mockResolvedValue(contact);
      mockContactService.getById.mockResolvedValue(contact);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/contacts/c1/tags',
        payload: { tagIds: ['tag-1', 'tag-2'] },
      });

      expect(res.statusCode).toBe(200);
      expect(mockContactService.applyTag).toHaveBeenCalledTimes(2);
      expect(mockContactService.applyTag).toHaveBeenCalledWith(RESTAURANT_ID, 'c1', 'tag-1');
      expect(mockContactService.applyTag).toHaveBeenCalledWith(RESTAURANT_ID, 'c1', 'tag-2');
    });

    it('returns 400 when tagIds is empty (Zod validation)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/contacts/c1/tags',
        payload: { tagIds: [] },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/v1/contacts/:id/tags/:tagId', () => {
    it('removes a tag and returns updated contact', async () => {
      const contact = { _id: 'c1', tags: [] };
      mockContactService.removeTag.mockResolvedValue(contact);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/contacts/c1/tags/tag-1',
      });

      expect(res.statusCode).toBe(200);
      expect(mockContactService.removeTag).toHaveBeenCalledWith(RESTAURANT_ID, 'c1', 'tag-1');
    });

    it('returns 404 when contact not found', async () => {
      mockContactService.removeTag.mockResolvedValue(null);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/contacts/nonexistent/tags/tag-1',
      });

      expect(res.statusCode).toBe(404);
    });
  });
});

// ── Tags Tests ─────────────────────────────────────────────────────────────

describe('US-017: REST API — Tags', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTagsApp();
  });

  describe('GET /api/v1/tags', () => {
    it('returns paginated list of tags', async () => {
      const paginated = {
        data: [{ _id: 'tag-1', name: 'VIP', color: '#FF0000', contactCount: 5 }],
        total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false,
      };
      mockTagRepo.findPaginated.mockResolvedValue(paginated);

      const res = await app.inject({ method: 'GET', url: '/api/v1/tags' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ data: expect.any(Array), total: 1 });
      expect(mockTagRepo.findPaginated).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.any(Object),
        expect.objectContaining({ sortBy: 'name', sortOrder: 'asc' }),
      );
    });
  });

  describe('POST /api/v1/tags', () => {
    it('creates a tag and returns 201', async () => {
      const created = { _id: 'tag-new', name: 'Loyal', color: '#00FF00', contactCount: 0 };
      mockTagRepo.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tags',
        payload: { name: 'Loyal', color: '#00FF00' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: 'Loyal' });
    });

    it('returns 400 when name is missing (Zod validation)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tags',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when color is not a valid hex (Zod validation)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tags',
        payload: { name: 'Bad Color', color: 'red' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /api/v1/tags/:id', () => {
    it('updates a tag and returns 200', async () => {
      const updated = { _id: 'tag-1', name: 'Updated Name' };
      mockTagRepo.updateById.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/tags/tag-1',
        payload: { name: 'Updated Name' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Updated Name' });
    });

    it('returns 404 when tag not found', async () => {
      mockTagRepo.updateById.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/tags/nonexistent',
        payload: { name: 'New Name' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/tags/:id', () => {
    it('deletes a non-system tag and returns success', async () => {
      const tag = { _id: 'tag-1', name: 'Loyal', isSystem: false };
      mockTagRepo.findById.mockResolvedValue(tag);
      mockTagRepo.deleteById.mockResolvedValue(true);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/tags/tag-1' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true });
    });

    it('returns 400 when trying to delete a system tag', async () => {
      const tag = { _id: 'tag-sys', name: 'System Tag', isSystem: true };
      mockTagRepo.findById.mockResolvedValue(tag);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/tags/tag-sys' });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringContaining('System') });
    });

    it('returns 404 when tag not found', async () => {
      mockTagRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/tags/nonexistent' });

      expect(res.statusCode).toBe(404);
    });
  });
});

// ── Templates Tests ─────────────────────────────────────────────────────────

describe('US-017: REST API — Templates', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTemplatesApp();
  });

  describe('GET /api/v1/templates', () => {
    it('returns paginated list of templates', async () => {
      const paginated = {
        data: [{ _id: 't1', name: 'Welcome Email', channel: 'email' }],
        total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false,
      };
      mockTemplateService.list.mockResolvedValue(paginated);

      const res = await app.inject({ method: 'GET', url: '/api/v1/templates' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ data: expect.any(Array), total: 1 });
    });

    it('filters by ?channel= query param', async () => {
      mockTemplateService.list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0, hasMore: false });

      await app.inject({ method: 'GET', url: '/api/v1/templates?channel=email' });

      expect(mockTemplateService.list).toHaveBeenCalledWith(
        RESTAURANT_ID,
        expect.objectContaining({ channel: 'email' }),
        expect.any(Object),
      );
    });
  });

  describe('POST /api/v1/templates', () => {
    it('creates a template and returns 201', async () => {
      const created = { _id: 't-new', name: 'New Email', channel: 'email', body: 'Hello {{first_name}}' };
      mockTemplateService.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/templates',
        payload: { name: 'New Email', channel: 'email', body: 'Hello {{first_name}}' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: 'New Email', channel: 'email' });
    });

    it('returns 400 when channel is invalid (Zod validation)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/templates',
        payload: { name: 'Bad', channel: 'push', body: 'Hello' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is missing (Zod validation)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/templates',
        payload: { name: 'No Body', channel: 'email' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /api/v1/templates/:id', () => {
    it('updates a template and returns 200', async () => {
      const updated = { _id: 't1', name: 'Updated Name', channel: 'email' };
      mockTemplateService.update.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/templates/t1',
        payload: { name: 'Updated Name' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Updated Name' });
    });

    it('returns 404 when template not found', async () => {
      mockTemplateService.update.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/templates/nonexistent',
        payload: { name: 'New Name' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/templates/:id', () => {
    it('deletes a template and returns success', async () => {
      mockTemplateService.delete.mockResolvedValue(true);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/templates/t1' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true });
    });

    it('returns 404 when template not found', async () => {
      mockTemplateService.delete.mockResolvedValue(false);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/templates/nonexistent' });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/templates/:id/preview', () => {
    it('returns interpolated subject and body with sampleData', async () => {
      const preview = { subject: 'Hello Alice', body: 'Dear Alice, welcome!' };
      mockTemplateService.preview.mockResolvedValue(preview);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/templates/t1/preview',
        payload: { sampleData: { first_name: 'Alice' } },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ subject: 'Hello Alice', body: 'Dear Alice, welcome!' });
      expect(mockTemplateService.preview).toHaveBeenCalledWith(
        RESTAURANT_ID,
        't1',
        expect.objectContaining({ first_name: 'Alice' }),
      );
    });

    it('returns 400 when sampleData is missing (Zod validation)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/templates/t1/preview',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });
});

// ── CustomFields Tests ──────────────────────────────────────────────────────

describe('US-017: REST API — CustomFields', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildCustomFieldsApp();
  });

  describe('GET /api/v1/custom-fields', () => {
    it('returns ordered list of custom fields', async () => {
      const fields = [
        { _id: 'cf1', key: 'birthday', name: 'Birthday', fieldType: 'date' },
        { _id: 'cf2', key: 'notes', name: 'Notes', fieldType: 'text' },
      ];
      mockCustomFieldRepo.findAllOrdered.mockResolvedValue(fields);

      const res = await app.inject({ method: 'GET', url: '/api/v1/custom-fields' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(fields);
      expect(mockCustomFieldRepo.findAllOrdered).toHaveBeenCalledWith(RESTAURANT_ID);
    });
  });

  describe('POST /api/v1/custom-fields', () => {
    it('creates a custom field and returns 201', async () => {
      const created = { _id: 'cf-new', key: 'birthday', name: 'Birthday', fieldType: 'date' };
      mockCustomFieldRepo.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/custom-fields',
        payload: { key: 'birthday', name: 'Birthday', fieldType: 'date' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ key: 'birthday', fieldType: 'date' });
    });

    it('returns 400 when key has uppercase letters (Zod regex)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/custom-fields',
        payload: { key: 'Birthday', name: 'Birthday', fieldType: 'date' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when fieldType is invalid (Zod enum)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/custom-fields',
        payload: { key: 'myfield', name: 'My Field', fieldType: 'image' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('accepts dropdown fieldType with options array', async () => {
      const created = { _id: 'cf-new', key: 'size', name: 'Size', fieldType: 'dropdown', options: ['S', 'M', 'L'] };
      mockCustomFieldRepo.create.mockResolvedValue(created);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/custom-fields',
        payload: { key: 'size', name: 'Size', fieldType: 'dropdown', options: ['S', 'M', 'L'] },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ fieldType: 'dropdown', options: ['S', 'M', 'L'] });
    });
  });

  describe('PUT /api/v1/custom-fields/:id', () => {
    it('updates a custom field and returns 200', async () => {
      const updated = { _id: 'cf1', name: 'Updated Name', fieldType: 'text' };
      mockCustomFieldRepo.updateById.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/custom-fields/cf1',
        payload: { name: 'Updated Name' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Updated Name' });
    });

    it('returns 404 when custom field not found', async () => {
      mockCustomFieldRepo.updateById.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/custom-fields/nonexistent',
        payload: { name: 'New Name' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/custom-fields/:id', () => {
    it('deletes a custom field and returns success', async () => {
      mockCustomFieldRepo.deleteById.mockResolvedValue(true);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/custom-fields/cf1' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true });
    });

    it('returns 404 when custom field not found', async () => {
      mockCustomFieldRepo.deleteById.mockResolvedValue(null);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/custom-fields/nonexistent' });

      expect(res.statusCode).toBe(404);
    });
  });
});
