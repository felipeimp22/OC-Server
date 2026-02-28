/**
 * @fileoverview Unit tests for ActionService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('@/config/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock env
vi.mock('@/config/env.js', () => ({
  env: {},
}));

// Mock retry helper to skip actual delays
vi.mock('@/utils/retryHelper.js', () => ({
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

// Mock axios
const mockAxiosPost = vi.fn();
vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => mockAxiosPost(...args),
  },
}));

// Mock Restaurant model
const mockRestaurantFindById = vi.fn();
vi.mock('@/domain/models/external/Restaurant.js', () => ({
  Restaurant: {
    findById: (...args: unknown[]) => mockRestaurantFindById(...args),
  },
}));

// Mock User model
const mockUserFindById = vi.fn();
vi.mock('@/domain/models/external/User.js', () => ({
  User: {
    findById: (...args: unknown[]) => mockUserFindById(...args),
  },
}));

// Mock CommunicationService (instance methods + static interpolate)
const mockCommService = {
  sendEmail: vi.fn(),
  sendSMS: vi.fn(),
};
const mockInterpolate = vi.fn((template: string) => template);
vi.mock('@/services/CommunicationService.js', () => ({
  CommunicationService: Object.assign(vi.fn(() => mockCommService), {
    interpolate: (...args: unknown[]) => mockInterpolate(...args),
  }),
}));

// Mock WebhookService
const mockWebhookService = {
  send: vi.fn(),
};
vi.mock('@/services/WebhookService.js', () => ({
  WebhookService: vi.fn(() => mockWebhookService),
}));

// Mock variableInterpolator
vi.mock('@/utils/variableInterpolator.js', () => ({
  buildContext: vi.fn(() => ({ first_name: 'John' })),
}));

import { ActionService } from '@/services/ActionService.js';

/** Build a minimal mock contact */
function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => 'contact-1' },
    email: 'john@example.com',
    firstName: 'John',
    lastName: 'Doe',
    phone: null,
    emailOptIn: true,
    smsOptIn: true,
    toObject: () => ({ _id: 'contact-1', email: 'john@example.com', firstName: 'John' }),
    ...overrides,
  };
}

/** Build a minimal mock flow node */
function makeNode(subType: string, config: Record<string, unknown> = {}) {
  return { type: 'action', subType, config };
}

describe('ActionService', () => {
  let service: ActionService;
  const restaurantId = 'rest-1';
  const executionId = 'exec-1';
  const flowId = 'flow-1';
  const context = {};

  beforeEach(() => {
    vi.clearAllMocks();
    // Default lean() returns null
    mockRestaurantFindById.mockReturnValue({ lean: () => Promise.resolve(null) });
    mockUserFindById.mockReturnValue({ lean: () => Promise.resolve(null) });
    // Default interpolate returns template unchanged
    mockInterpolate.mockImplementation((template: string) => template);
    service = new ActionService();
  });

  describe('execute() — never throws', () => {
    it('returns { success: false, error } on unexpected error without throwing', async () => {
      mockCommService.sendEmail.mockRejectedValue(new Error('network error'));
      const node = makeNode('send_email', {
        recipients: [{ type: 'customer' }],
        subject: 'Hi',
        body: 'Body',
      });
      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('network error');
    });
  });

  describe('send_email', () => {
    it('resolves customer recipient → contact email', async () => {
      mockCommService.sendEmail.mockResolvedValue({ _id: 'log-1' });
      const node = makeNode('send_email', {
        recipients: [{ type: 'customer' }],
        subject: 'Hello',
        body: 'Body',
      });

      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('send_email');
      expect(mockCommService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId,
          contactId: 'contact-1',
          to: ['john@example.com'],
          subject: 'Hello',
          body: 'Body',
          executionId,
          flowId,
        }),
      );
    });

    it('resolves restaurant recipient → restaurant email', async () => {
      mockCommService.sendEmail.mockResolvedValue({});
      mockRestaurantFindById.mockReturnValue({ lean: () => Promise.resolve({ email: 'owner@rest.com' }) });
      const node = makeNode('send_email', {
        recipients: [{ type: 'restaurant' }],
        subject: 'Hi',
        body: 'Body',
      });

      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(true);
      expect(mockCommService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: ['owner@rest.com'] }),
      );
    });

    it('resolves staff recipient → user email', async () => {
      mockCommService.sendEmail.mockResolvedValue({});
      mockUserFindById.mockReturnValue({ lean: () => Promise.resolve({ email: 'staff@rest.com' }) });
      const node = makeNode('send_email', {
        recipients: [{ type: 'staff', userId: 'user-abc' }],
        subject: 'Hi',
        body: 'Body',
      });

      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(true);
      expect(mockUserFindById).toHaveBeenCalledWith('user-abc');
      expect(mockCommService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: ['staff@rest.com'] }),
      );
    });

    it('resolves custom recipient → literal email', async () => {
      mockCommService.sendEmail.mockResolvedValue({});
      const node = makeNode('send_email', {
        recipients: [{ type: 'custom', email: 'custom@example.com' }],
        subject: 'Hi',
        body: 'Body',
      });

      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(true);
      expect(mockCommService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: ['custom@example.com'] }),
      );
    });

    it('resolves multiple recipients to combined list', async () => {
      mockCommService.sendEmail.mockResolvedValue({});
      mockRestaurantFindById.mockReturnValue({ lean: () => Promise.resolve({ email: 'owner@rest.com' }) });
      const node = makeNode('send_email', {
        recipients: [{ type: 'customer' }, { type: 'restaurant' }],
        subject: 'Hi',
        body: 'Body',
      });

      await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(mockCommService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: ['john@example.com', 'owner@rest.com'] }),
      );
    });

    it('sends empty to[] when no recipients configured', async () => {
      mockCommService.sendEmail.mockResolvedValue({});
      const node = makeNode('send_email', { recipients: [], subject: 'Hi', body: 'Body' });

      await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(mockCommService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: [] }),
      );
    });
  });

  describe('send_sms', () => {
    it('skips when no recipient config and contact has no phone', async () => {
      const node = makeNode('send_sms', { body: 'Hello' });
      const contact = makeContact({ phone: null });

      const result = await service.execute(
        node as any, contact as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(true);
      expect(mockCommService.sendSMS).not.toHaveBeenCalled();
      expect(result.metadata).toMatchObject({ skipped: true, reason: 'no_phone' });
    });

    it('resolves customer recipient → contact phone', async () => {
      mockCommService.sendSMS.mockResolvedValue({});
      const node = makeNode('send_sms', { recipient: { type: 'customer' }, body: 'Hi' });
      const contact = makeContact({ phone: { countryCode: '+1', number: '5551234567' } });

      const result = await service.execute(
        node as any, contact as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(true);
      expect(mockCommService.sendSMS).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId, to: '+15551234567' }),
      );
    });

    it('resolves restaurant recipient → restaurant phone', async () => {
      mockCommService.sendSMS.mockResolvedValue({});
      mockRestaurantFindById.mockReturnValue({ lean: () => Promise.resolve({ phone: '+18885550000' }) });
      const node = makeNode('send_sms', { recipient: { type: 'restaurant' }, body: 'Hi' });

      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(true);
      expect(mockCommService.sendSMS).toHaveBeenCalledWith(
        expect.objectContaining({ to: '+18885550000' }),
      );
    });

    it('resolves custom recipient → literal phone', async () => {
      mockCommService.sendSMS.mockResolvedValue({});
      const node = makeNode('send_sms', { recipient: { type: 'custom', phone: '+19995550001' }, body: 'Hi' });

      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(true);
      expect(mockCommService.sendSMS).toHaveBeenCalledWith(
        expect.objectContaining({ to: '+19995550001' }),
      );
    });
  });

  describe('outgoing_webhook', () => {
    it('interpolates body, parses JSON, calls axios.post, returns { success: true }', async () => {
      mockAxiosPost.mockResolvedValue({ status: 200 });
      mockInterpolate.mockReturnValue('{"key":"value"}');
      const node = makeNode('outgoing_webhook', { url: 'https://example.com/hook', body: '{"key":"{{value}}"}' });

      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('outgoing_webhook');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://example.com/hook',
        { key: 'value' },
        { timeout: 10_000 },
      );
    });

    it('returns { success: false, error: "invalid_json" } when body is invalid JSON after interpolation', async () => {
      mockInterpolate.mockReturnValue('not valid json');
      const node = makeNode('outgoing_webhook', { url: 'https://example.com/hook', body: 'not valid json' });

      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_json');
      expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    it('returns { success: false } when URL is missing', async () => {
      const node = makeNode('outgoing_webhook', {});

      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(false);
    });
  });

  describe('unsupported action type', () => {
    it('logs error and returns { success: false, error: "action_not_supported" }', async () => {
      const node = makeNode('unknown_type', {});

      const result = await service.execute(
        node as any, makeContact() as any, restaurantId, context, executionId, flowId,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('action_not_supported');
    });
  });
});
