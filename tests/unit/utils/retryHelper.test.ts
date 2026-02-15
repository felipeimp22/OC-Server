/**
 * @fileoverview Unit tests for retry helper utility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger
vi.mock('@/config/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { withRetry } from '@/utils/retryHelper.js';

describe('retryHelper', () => {
  describe('withRetry', () => {
    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValue('success');

      const result = await withRetry(fn, { initialDelayMs: 1, backoffMultiplier: 1 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw after max attempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fail'));

      await expect(
        withRetry(fn, { maxAttempts: 2, initialDelayMs: 1, backoffMultiplier: 1 }),
      ).rejects.toThrow('always fail');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should respect maxAttempts=1 (no retry)', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(
        withRetry(fn, { maxAttempts: 1 }),
      ).rejects.toThrow('fail');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error throws', async () => {
      const fn = vi.fn().mockRejectedValue('string error');

      await expect(
        withRetry(fn, { maxAttempts: 1 }),
      ).rejects.toThrow('string error');
    });

    it('should retry the configured number of times', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('ok');

      const result = await withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 1,
        backoffMultiplier: 1,
      });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});
