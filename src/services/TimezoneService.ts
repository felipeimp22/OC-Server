/**
 * @fileoverview TimezoneService — caches restaurant timezone lookups.
 *
 * Queries the store_hours collection for a restaurant's timezone and
 * caches results in-memory with a 5-minute TTL.
 *
 * @module services/TimezoneService
 */

import { StoreHours } from '../domain/models/external/StoreHours.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('TimezoneService');

const DEFAULT_TIMEZONE = 'America/New_York';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  timezone: string;
  expiresAt: number;
}

class TimezoneService {
  private cache: Map<string, CacheEntry> = new Map();

  async getTimezone(restaurantId: string): Promise<string> {
    const now = Date.now();
    const entry = this.cache.get(restaurantId);

    if (entry && entry.expiresAt > now) {
      return entry.timezone;
    }

    try {
      const storeHours = await StoreHours.findOne({ restaurantId }).lean().exec();
      const timezone = storeHours?.timezone ?? DEFAULT_TIMEZONE;

      this.cache.set(restaurantId, { timezone, expiresAt: now + CACHE_TTL_MS });
      return timezone;
    } catch (err) {
      log.warn({ err, restaurantId }, 'Failed to fetch timezone, using default');
      return DEFAULT_TIMEZONE;
    }
  }
}

export const timezoneService = new TimezoneService();
