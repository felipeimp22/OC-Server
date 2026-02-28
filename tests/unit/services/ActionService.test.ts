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
  env: {
    META_PIXEL_ID: '',
    META_ACCESS_TOKEN: '',
  },
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

// Mock MetaProviderFactory
const mockMetaProvider = {
  sendEvent: vi.fn(),
};
vi.mock('@/factories/MetaProviderFactory.js', () => ({
  getMetaProvider: vi.fn(() => null),
}));

// Mock CommunicationService
const mockCommService = {
  sendEmail: vi.fn(),
  sendSMS: vi.fn(),
};
vi.mock('@/services/CommunicationService.js', () => ({
  CommunicationService: vi.fn(() => mockCommService),
}));

// Mock ContactService
const mockContactService = {
  applyTag: vi.fn(),
  removeTag: vi.fn(),
  update: vi.fn(),
};
vi.mock('@/services/ContactService.js', () => ({
  ContactService: vi.fn(() => mockContactService),
}));

// Mock TaskRepository
const mockTaskRepo = {
  create: vi.fn(),
};
vi.mock('@/repositories/TaskRepository.js', () => ({
  TaskRepository: vi.fn(() => mockTaskRepo),
}));

// Mock variableInterpolator
vi.mock('@/utils/variableInterpolator.js', () => ({
  buildContext: vi.fn(() => ({ first_name: 'John' })),
}));

import { ActionService } from '@/services/ActionService.js';
import { getMetaProvider } from '@/factories/MetaProviderFactory.js';

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
    // Reset meta provider to null (not configured)
    vi.mocked(getMetaProvider).mockReturnValue(null);
    service = new ActionService();
  });

  describe('execute() — never throws', () => {
    it('returns { success: false, error } on unexpected error without throwing', async () => {
      mockCommService.sendEmail.mockRejectedValue(new Error('network error'));
      const node = makeNode('send_email', { subject: 'Hi', body: 'Body' });
      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('network error');
    });
  });

  describe('send_email', () => {
    it('calls CommunicationService.sendEmail and returns { success: true }', async () => {
      mockCommService.sendEmail.mockResolvedValue({ _id: 'log-1' });
      const node = makeNode('send_email', { subject: 'Hello', body: 'Body', templateId: 'tpl-1' });
      const contact = makeContact();

      const result = await service.execute(node as any, contact as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(result.action).toBe('send_email');
      expect(mockCommService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId,
          contactId: 'contact-1',
          to: 'john@example.com',
          executionId,
          flowId,
        }),
      );
    });
  });

  describe('send_sms', () => {
    it('skips send and returns { success: true } when contact has no phone', async () => {
      const node = makeNode('send_sms', { body: 'Hello' });
      const contact = makeContact({ phone: null });

      const result = await service.execute(node as any, contact as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(mockCommService.sendSMS).not.toHaveBeenCalled();
      expect(result.metadata).toMatchObject({ skipped: true, reason: 'no_phone' });
    });

    it('calls CommunicationService.sendSMS when contact has phone', async () => {
      mockCommService.sendSMS.mockResolvedValue({ _id: 'log-2' });
      const node = makeNode('send_sms', { body: 'Hi' });
      const contact = makeContact({ phone: { countryCode: '+1', number: '5551234567' } });

      const result = await service.execute(node as any, contact as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(mockCommService.sendSMS).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId, to: '+15551234567' }),
      );
    });
  });

  describe('apply_tag', () => {
    it('calls ContactService.applyTag and returns { success: true }', async () => {
      const updatedContact = makeContact();
      mockContactService.applyTag.mockResolvedValue(updatedContact);
      const node = makeNode('apply_tag', { tagId: 'tag-abc' });

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(result.action).toBe('apply_tag');
      expect(mockContactService.applyTag).toHaveBeenCalledWith(restaurantId, 'contact-1', 'tag-abc');
    });

    it('returns { success: false } when tagId is missing', async () => {
      const node = makeNode('apply_tag', {});

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(false);
      expect(mockContactService.applyTag).not.toHaveBeenCalled();
    });
  });

  describe('remove_tag', () => {
    it('calls ContactService.removeTag and returns { success: true }', async () => {
      mockContactService.removeTag.mockResolvedValue(makeContact());
      const node = makeNode('remove_tag', { tagId: 'tag-abc' });

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(result.action).toBe('remove_tag');
      expect(mockContactService.removeTag).toHaveBeenCalledWith(restaurantId, 'contact-1', 'tag-abc');
    });
  });

  describe('update_field', () => {
    it('calls ContactService.update with customFields key and returns { success: true }', async () => {
      mockContactService.update.mockResolvedValue(makeContact());
      const node = makeNode('update_field', { key: 'vip_tier', value: 'gold' });

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(result.action).toBe('update_field');
      expect(mockContactService.update).toHaveBeenCalledWith(
        restaurantId,
        'contact-1',
        expect.objectContaining({ 'customFields.vip_tier': 'gold' }),
      );
    });
  });

  describe('create_task', () => {
    it('creates a task with dueAt = now + dueInDays * 86400000', async () => {
      mockTaskRepo.create.mockResolvedValue({ _id: { toString: () => 'task-1' } });
      const node = makeNode('create_task', { title: 'Follow up', dueInDays: 3 });
      const before = Date.now();

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(result.action).toBe('create_task');
      expect(mockTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId,
          contactId: expect.anything(),
          title: 'Follow up',
        }),
      );
      // Verify dueAt is approximately 3 days from now
      const call = mockTaskRepo.create.mock.calls[0][0];
      expect(call.dueAt.getTime()).toBeGreaterThanOrEqual(before + 3 * 86400000 - 100);
      expect(call.dueAt.getTime()).toBeLessThanOrEqual(Date.now() + 3 * 86400000 + 100);
    });
  });

  describe('outgoing_webhook', () => {
    it('calls axios.post with withRetry and returns { success: true }', async () => {
      mockAxiosPost.mockResolvedValue({ status: 200 });
      const node = makeNode('outgoing_webhook', { url: 'https://example.com/hook' });

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(result.action).toBe('outgoing_webhook');
      expect(mockAxiosPost).toHaveBeenCalledWith('https://example.com/hook', context, { timeout: 10_000 });
    });

    it('returns { success: false } when URL is missing', async () => {
      const node = makeNode('outgoing_webhook', {});

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(false);
    });
  });

  describe('meta_capi', () => {
    it('returns { success: false, error: "not configured" } when META_PIXEL_ID is unset', async () => {
      vi.mocked(getMetaProvider).mockReturnValue(null);
      const node = makeNode('meta_capi', { eventName: 'Purchase' });

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('not configured');
    });

    it('calls metaProvider.sendEvent when configured', async () => {
      mockMetaProvider.sendEvent.mockResolvedValue({ success: true });
      vi.mocked(getMetaProvider).mockReturnValue(mockMetaProvider as any);
      const node = makeNode('meta_capi', { eventName: 'Purchase' });

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(mockMetaProvider.sendEvent).toHaveBeenCalled();
    });
  });

  describe('admin_notification', () => {
    it('calls CommunicationService.sendEmail with config.to/subject/body', async () => {
      mockCommService.sendEmail.mockResolvedValue({ _id: 'log-3' });
      const node = makeNode('admin_notification', {
        to: 'admin@restaurant.com',
        subject: 'Alert',
        body: 'A contact just ordered!',
      });

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(result.action).toBe('admin_notification');
      expect(mockCommService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId,
          to: 'admin@restaurant.com',
          subject: 'Alert',
          body: 'A contact just ordered!',
        }),
      );
    });

    it('returns { success: false } when no recipient configured', async () => {
      const node = makeNode('admin_notification', {});

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(false);
    });
  });

  describe('add_note', () => {
    it('returns { success: true } as a stub (no persistence)', async () => {
      const node = makeNode('add_note', { note: 'Some note' });

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(result.action).toBe('add_note');
    });
  });

  describe('assign_owner', () => {
    it('returns { success: true } as a stub (no persistence)', async () => {
      const node = makeNode('assign_owner', { ownerId: 'user-1' });

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(true);
      expect(result.action).toBe('assign_owner');
    });
  });

  describe('unknown action type', () => {
    it('returns { success: false, error: "Unknown action type" }', async () => {
      const node = makeNode('unknown_type', {});

      const result = await service.execute(node as any, makeContact() as any, restaurantId, context, executionId, flowId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action type');
    });
  });
});
