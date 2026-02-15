/**
 * @fileoverview Segmentation Service — auto-calculates lifecycle status.
 *
 * Rules:
 * - No orders → "lead"
 * - 1 order → "first_time"
 * - 2+ orders in last 90 days → "returning"
 * - No order in 60+ days (was returning) → "lost"
 * - Was "lost", ordered again → "recovered"
 * - Lifetime value > threshold OR orders > threshold → "VIP"
 *
 * @module services/SegmentationService
 */

import { ContactRepository } from '../repositories/ContactRepository.js';
import type { IContactDocument } from '../domain/models/crm/Contact.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('SegmentationService');

/** Configurable thresholds per restaurant (defaults) */
export interface SegmentationThresholds {
  vipOrderCount: number;
  vipLifetimeValue: number;
  returningDays: number;
  lostDays: number;
}

const DEFAULT_THRESHOLDS: SegmentationThresholds = {
  vipOrderCount: 10,
  vipLifetimeValue: 500,
  returningDays: 90,
  lostDays: 60,
};

export class SegmentationService {
  private readonly contactRepo: ContactRepository;

  constructor() {
    this.contactRepo = new ContactRepository();
  }

  /**
   * Calculate the correct lifecycle status for a single contact.
   *
   * @param contact - The CRM contact
   * @param thresholds - Optional custom thresholds
   * @returns The calculated lifecycle status
   */
  calculateLifecycle(
    contact: IContactDocument,
    thresholds: SegmentationThresholds = DEFAULT_THRESHOLDS,
  ): string {
    const now = Date.now();
    const daysSinceLast = contact.lastOrderAt
      ? (now - new Date(contact.lastOrderAt).getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;

    // VIP check first (highest priority)
    if (
      contact.totalOrders >= thresholds.vipOrderCount ||
      contact.lifetimeValue >= thresholds.vipLifetimeValue
    ) {
      return 'VIP';
    }

    // No orders → lead
    if (contact.totalOrders === 0) {
      return 'lead';
    }

    // 1 order → first_time
    if (contact.totalOrders === 1) {
      return daysSinceLast > thresholds.lostDays ? 'lost' : 'first_time';
    }

    // Was lost, ordered again → recovered
    if (contact.lifecycleStatus === 'lost' && daysSinceLast < 1) {
      return 'recovered';
    }

    // No order in X days → lost
    if (daysSinceLast > thresholds.lostDays) {
      return 'lost';
    }

    // 2+ orders in recent window → returning
    if (daysSinceLast <= thresholds.returningDays) {
      return 'returning';
    }

    // Default returning
    return 'returning';
  }

  /**
   * Recalculate and update lifecycle for all contacts in a restaurant.
   * Called by the LifecycleUpdater cron job.
   *
   * @param restaurantId - Tenant ID
   * @returns Number of contacts updated
   */
  async recalculateAll(restaurantId: string): Promise<number> {
    const contacts = await this.contactRepo.find(restaurantId);
    let updatedCount = 0;

    for (const contact of contacts) {
      const newStatus = this.calculateLifecycle(contact);
      if (newStatus !== contact.lifecycleStatus) {
        await this.contactRepo.updateById(restaurantId, contact._id.toString(), {
          $set: { lifecycleStatus: newStatus },
        });
        updatedCount++;
      }
    }

    log.info({ restaurantId, total: contacts.length, updated: updatedCount }, 'Lifecycle recalculation complete');
    return updatedCount;
  }
}
