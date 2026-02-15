/**
 * @fileoverview CRM Link Tracking repository.
 *
 * @module repositories/LinkTrackingRepository
 */

import { BaseRepository } from './base/BaseRepository.js';
import { LinkTracking, type ILinkTrackingDocument } from '../domain/models/crm/LinkTracking.js';

export class LinkTrackingRepository extends BaseRepository<ILinkTrackingDocument> {
  constructor() {
    super(LinkTracking, 'LinkTrackingRepository');
  }

  /**
   * Find a link by its tracking URL (for redirect + click recording).
   */
  async findByTrackingUrl(trackingUrl: string): Promise<ILinkTrackingDocument | null> {
    return this.model.findOne({ trackingUrl }).exec();
  }

  /**
   * Record a click on a tracked link (atomic increment).
   */
  async recordClick(trackingUrl: string): Promise<ILinkTrackingDocument | null> {
    return this.model.findOneAndUpdate(
      { trackingUrl },
      { $inc: { clickCount: 1 }, $set: { lastClickedAt: new Date() } },
      { new: true },
    ).exec();
  }
}
