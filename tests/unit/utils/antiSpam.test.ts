/**
 * @fileoverview Unit tests for anti-spam / cooldown utility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger before importing antiSpam
vi.mock('@/config/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  checkFrequencyLimit,
  checkReviewCooldown,
  DEFAULT_COOLDOWNS,
} from '@/utils/antiSpam.js';

describe('antiSpam', () => {
  describe('DEFAULT_COOLDOWNS', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_COOLDOWNS.reviewRequestDays).toBe(7);
      expect(DEFAULT_COOLDOWNS.maxEmailsPerDay).toBe(3);
      expect(DEFAULT_COOLDOWNS.maxSmsPerDay).toBe(2);
      expect(DEFAULT_COOLDOWNS.minOrderValueForReview).toBe(0);
    });
  });

  describe('checkFrequencyLimit', () => {
    it('should allow email when under limit', () => {
      const result = checkFrequencyLimit(0, 'email');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should allow email at (limit - 1)', () => {
      const result = checkFrequencyLimit(DEFAULT_COOLDOWNS.maxEmailsPerDay - 1, 'email');
      expect(result.allowed).toBe(true);
    });

    it('should block email at limit', () => {
      const result = checkFrequencyLimit(DEFAULT_COOLDOWNS.maxEmailsPerDay, 'email');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('frequency limit reached');
    });

    it('should block email above limit', () => {
      const result = checkFrequencyLimit(10, 'email');
      expect(result.allowed).toBe(false);
    });

    it('should allow sms when under limit', () => {
      const result = checkFrequencyLimit(0, 'sms');
      expect(result.allowed).toBe(true);
    });

    it('should block sms at limit', () => {
      const result = checkFrequencyLimit(DEFAULT_COOLDOWNS.maxSmsPerDay, 'sms');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('sms');
    });

    it('should include channel name in reason', () => {
      const emailResult = checkFrequencyLimit(10, 'email');
      expect(emailResult.reason).toContain('email');

      const smsResult = checkFrequencyLimit(10, 'sms');
      expect(smsResult.reason).toContain('sms');
    });
  });

  describe('checkReviewCooldown', () => {
    it('should allow when no previous review request', () => {
      const result = checkReviewCooldown(null);
      expect(result.allowed).toBe(true);
    });

    it('should allow when cooldown has elapsed', () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const result = checkReviewCooldown(eightDaysAgo);
      expect(result.allowed).toBe(true);
    });

    it('should block when cooldown active', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const result = checkReviewCooldown(twoDaysAgo);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cooldown active');
    });

    it('should respect custom cooldown days', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      // 2-day cooldown: 3 days ago should be allowed
      const allowed = checkReviewCooldown(threeDaysAgo, 2);
      expect(allowed.allowed).toBe(true);

      // 5-day cooldown: 3 days ago should be blocked
      const blocked = checkReviewCooldown(threeDaysAgo, 5);
      expect(blocked.allowed).toBe(false);
    });

    it('should block when request was today', () => {
      const now = new Date();
      const result = checkReviewCooldown(now);
      expect(result.allowed).toBe(false);
    });

    it('should allow at exactly the cooldown boundary', () => {
      const exactlySevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const result = checkReviewCooldown(exactlySevenDaysAgo, 7);
      expect(result.allowed).toBe(true);
    });
  });
});
