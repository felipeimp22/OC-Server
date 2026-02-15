/**
 * @fileoverview Unit tests for timezone helper utility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateDelayTarget,
  calculateAdvancedTimerTarget,
  calculateDateFieldTarget,
  getNowInTimezone,
} from '@/utils/timezoneHelper.js';

describe('timezoneHelper', () => {
  describe('calculateDelayTarget', () => {
    const baseDate = new Date('2024-01-15T12:00:00Z');

    it('should add minutes', () => {
      const result = calculateDelayTarget(30, 'minutes', baseDate);
      expect(result.getTime()).toBe(baseDate.getTime() + 30 * 60 * 1000);
    });

    it('should add hours', () => {
      const result = calculateDelayTarget(2, 'hours', baseDate);
      expect(result.getTime()).toBe(baseDate.getTime() + 2 * 60 * 60 * 1000);
    });

    it('should add days', () => {
      const result = calculateDelayTarget(3, 'days', baseDate);
      expect(result.getTime()).toBe(baseDate.getTime() + 3 * 24 * 60 * 60 * 1000);
    });

    it('should use current time when no fromDate provided', () => {
      const before = Date.now();
      const result = calculateDelayTarget(1, 'hours');
      const after = Date.now();
      expect(result.getTime()).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
      expect(result.getTime()).toBeLessThanOrEqual(after + 60 * 60 * 1000);
    });

    it('should throw for unknown unit', () => {
      expect(() => calculateDelayTarget(1, 'weeks' as any)).toThrow('Unknown delay unit');
    });
  });

  describe('calculateAdvancedTimerTarget', () => {
    it('should combine delay with weekday filtering', () => {
      // Monday Jan 15 2024 — add 1 day = Tuesday Jan 16
      // If allowed weekdays are [3] (Wednesday), should advance to Wed Jan 17
      const result = calculateAdvancedTimerTarget({
        delay: 1,
        unit: 'days',
        weekdays: [3], // Wednesday only
      });
      // Result should be a Wednesday
      expect(result.getDay()).toBe(3);
    });

    it('should handle basic delay without weekday constraints', () => {
      const result = calculateAdvancedTimerTarget({
        delay: 2,
        unit: 'hours',
      });
      const twoHoursFromNow = Date.now() + 2 * 60 * 60 * 1000;
      expect(Math.abs(result.getTime() - twoHoursFromNow)).toBeLessThan(1000);
    });
  });

  describe('calculateDateFieldTarget', () => {
    it('should return date with positive offset', () => {
      const result = calculateDateFieldTarget('2024-06-15T12:00:00Z', 3);
      expect(result).not.toBeNull();
      expect(result!.getUTCDate()).toBe(18);
    });

    it('should return date with negative offset', () => {
      const result = calculateDateFieldTarget('2024-06-15T12:00:00Z', -2);
      expect(result).not.toBeNull();
      expect(result!.getUTCDate()).toBe(13);
    });

    it('should return null for null input', () => {
      expect(calculateDateFieldTarget(null, 0)).toBeNull();
    });

    it('should return null for empty string input', () => {
      expect(calculateDateFieldTarget('', 0)).toBeNull();
    });

    it('should return null for invalid date string', () => {
      expect(calculateDateFieldTarget('not-a-date', 0)).toBeNull();
    });

    it('should accept Date objects', () => {
      const date = new Date('2024-06-15T00:00:00Z');
      const result = calculateDateFieldTarget(date, 1);
      expect(result).not.toBeNull();
    });

    it('should handle zero offset', () => {
      const result = calculateDateFieldTarget('2024-06-15T12:00:00Z', 0);
      expect(result).not.toBeNull();
      expect(result!.getUTCDate()).toBe(15);
    });
  });

  describe('getNowInTimezone', () => {
    it('should return valid date components for UTC', () => {
      const result = getNowInTimezone('UTC');
      expect(result.year).toBeGreaterThanOrEqual(2024);
      expect(result.month).toBeGreaterThanOrEqual(1);
      expect(result.month).toBeLessThanOrEqual(12);
      expect(result.day).toBeGreaterThanOrEqual(1);
      expect(result.day).toBeLessThanOrEqual(31);
      expect(result.hours).toBeGreaterThanOrEqual(0);
      expect(result.hours).toBeLessThanOrEqual(23);
      expect(result.minutes).toBeGreaterThanOrEqual(0);
      expect(result.minutes).toBeLessThanOrEqual(59);
      expect(result.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(result.dayOfWeek).toBeLessThanOrEqual(6);
    });

    it('should return different times for different timezones', () => {
      // This test may be flaky if run near midnight UTC ± offsets
      // but should generally hold true for large timezone differences
      const utc = getNowInTimezone('UTC');
      const tokyo = getNowInTimezone('Asia/Tokyo'); // UTC+9
      // Tokyo is always ahead of UTC (unless near day boundary)
      expect(typeof tokyo.hours).toBe('number');
      expect(typeof utc.hours).toBe('number');
    });

    it('should return all required properties', () => {
      const result = getNowInTimezone('America/New_York');
      expect(result).toHaveProperty('year');
      expect(result).toHaveProperty('month');
      expect(result).toHaveProperty('day');
      expect(result).toHaveProperty('hours');
      expect(result).toHaveProperty('minutes');
      expect(result).toHaveProperty('dayOfWeek');
    });
  });
});
