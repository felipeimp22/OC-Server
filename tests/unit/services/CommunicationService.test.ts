/**
 * @fileoverview Unit tests for CommunicationService.
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
    EMAIL_FROM_ADDRESS: 'noreply@restaurant.com',
    EMAIL_DOMAIN: 'restaurant.com',
  },
}));

// Mock retry helper to skip actual delays
vi.mock('@/utils/retryHelper.js', () => ({
  withRetry: vi.fn(async (fn: () => Promise<any>) => fn()),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
}));

// Mock repositories
const mockTemplateRepo = {
  findById: vi.fn(),
};
const mockCommLogRepo = {
  create: vi.fn(),
  updateStatus: vi.fn(),
  updateById: vi.fn(),
};
const mockContactRepo = {
  findById: vi.fn(),
};
const mockLinkTrackingRepo = {
  create: vi.fn(),
  recordClick: vi.fn(),
};

vi.mock('@/repositories/TemplateRepository.js', () => ({
  TemplateRepository: vi.fn(() => mockTemplateRepo),
}));
vi.mock('@/repositories/CommunicationLogRepository.js', () => ({
  CommunicationLogRepository: vi.fn(() => mockCommLogRepo),
}));
vi.mock('@/repositories/ContactRepository.js', () => ({
  ContactRepository: vi.fn(() => mockContactRepo),
}));
vi.mock('@/repositories/LinkTrackingRepository.js', () => ({
  LinkTrackingRepository: vi.fn(() => mockLinkTrackingRepo),
}));

// Mock email provider only (SMS is stubbed)
const mockEmailProvider = {
  sendEmail: vi.fn(),
};

vi.mock('@/factories/EmailProviderFactory.js', () => ({
  getEmailProvider: () => mockEmailProvider,
}));

import { CommunicationService } from '@/services/CommunicationService.js';

describe('CommunicationService', () => {
  let service: CommunicationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CommunicationService();

    // Default: contact has emailOptIn: true
    mockContactRepo.findById.mockResolvedValue({ emailOptIn: true });

    // Default mock: commLog.create returns a minimal object
    mockCommLogRepo.create.mockResolvedValue({
      _id: 'log-1',
      restaurantId: 'rest-1',
      contactId: 'contact-1',
      channel: 'email',
      status: 'queued',
    });
  });

  describe('sendEmail', () => {
    it('should send an email and update log to sent', async () => {
      mockEmailProvider.sendEmail.mockResolvedValue({
        messageId: 'msg-123',
        status: 'sent',
        timestamp: new Date(),
      });

      const result = await service.sendEmail({
        restaurantId: 'rest-1',
        contactId: 'contact-1',
        to: ['john@example.com'],
        subject: 'Hello {{first_name}}',
        body: '<p>Welcome, {{first_name}}!</p>',
        context: { first_name: 'John' },
      });

      expect(result._id).toBe('log-1');
      expect(mockCommLogRepo.create).toHaveBeenCalled();
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['john@example.com'],
          from: 'noreply@restaurant.com',
          subject: 'Hello John',
          html: '<p>Welcome, John!</p>',
        }),
      );
      expect(mockCommLogRepo.updateStatus).toHaveBeenCalledWith('log-1', 'sent');
    });

    it('should skip send and log opted_out when emailOptIn is false', async () => {
      mockContactRepo.findById.mockResolvedValue({ emailOptIn: false });

      await service.sendEmail({
        restaurantId: 'rest-1',
        contactId: 'contact-1',
        to: ['john@example.com'],
        subject: 'Hello',
        body: 'Body',
        context: {},
      });

      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockCommLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'skipped', reason: 'opted_out' }),
      );
    });

    it('should load a template when templateId is provided', async () => {
      mockTemplateRepo.findById.mockResolvedValue({
        subject: 'Template Subject: {{first_name}}',
        body: '<p>Template body for {{first_name}}</p>',
      });
      mockEmailProvider.sendEmail.mockResolvedValue({
        messageId: 'msg-456',
        status: 'sent',
        timestamp: new Date(),
      });

      await service.sendEmail({
        restaurantId: 'rest-1',
        contactId: 'contact-1',
        to: ['john@example.com'],
        templateId: 'tpl-1',
        context: { first_name: 'John' },
      });

      expect(mockTemplateRepo.findById).toHaveBeenCalledWith('rest-1', 'tpl-1');
      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Template Subject: John',
          html: '<p>Template body for John</p>',
        }),
      );
    });

    it('should mark log as failed when provider throws', async () => {
      mockEmailProvider.sendEmail.mockRejectedValue(new Error('Provider error'));

      await service.sendEmail({
        restaurantId: 'rest-1',
        contactId: 'contact-1',
        to: ['john@example.com'],
        subject: 'Test',
        body: 'Test',
        context: {},
      });

      expect(mockCommLogRepo.updateStatus).toHaveBeenCalledWith('log-1', 'failed');
    });
  });

  describe('sendSMS', () => {
    it('should log skipped with sms_stub and NOT call any SMS provider', async () => {
      const result = await service.sendSMS({
        restaurantId: 'rest-1',
        contactId: 'contact-1',
        to: '+15551234567',
        body: 'Hi {{first_name}}, your order is ready!',
        context: { first_name: 'Maria' },
      });

      expect(result._id).toBe('log-1');
      expect(mockCommLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'skipped', reason: 'sms_stub', channel: 'sms' }),
      );
    });
  });

  describe('createTrackingUrl', () => {
    it('should create a tracking record and return URL', async () => {
      mockLinkTrackingRepo.create.mockResolvedValue({});

      const url = await service.createTrackingUrl('log-1', 'contact-1', 'https://google.com');

      expect(url).toMatch(/^\/t\/[a-f0-9]+$/);
      expect(mockLinkTrackingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          communicationLogId: 'log-1',
          contactId: 'contact-1',
          originalUrl: 'https://google.com',
          clickCount: 0,
        }),
      );
    });
  });

  describe('recordLinkClick', () => {
    it('should return original URL when tracking record found', async () => {
      mockLinkTrackingRepo.recordClick.mockResolvedValue({
        originalUrl: 'https://google.com',
      });

      const url = await service.recordLinkClick('/t/abc123');
      expect(url).toBe('https://google.com');
    });

    it('should return null when tracking record not found', async () => {
      mockLinkTrackingRepo.recordClick.mockResolvedValue(null);

      const url = await service.recordLinkClick('/t/nonexistent');
      expect(url).toBeNull();
    });
  });
});
