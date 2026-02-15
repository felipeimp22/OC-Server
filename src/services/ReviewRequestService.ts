/**
 * @fileoverview Review Request Service — manages the post-order review system.
 *
 * @module services/ReviewRequestService
 */

import { ReviewRequestRepository } from '../repositories/ReviewRequestRepository.js';
import { ContactRepository } from '../repositories/ContactRepository.js';
import type { IReviewRequestDocument } from '../domain/models/crm/ReviewRequest.js';
import { checkReviewCooldown } from '../utils/antiSpam.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('ReviewRequestService');

export class ReviewRequestService {
  private readonly reviewRepo: ReviewRequestRepository;
  private readonly contactRepo: ContactRepository;

  constructor() {
    this.reviewRepo = new ReviewRequestRepository();
    this.contactRepo = new ContactRepository();
  }

  /**
   * Schedule a review request for a completed order.
   * Enforces anti-spam rules (one per order, cooldown period).
   */
  async scheduleReviewRequest(
    restaurantId: string,
    contactId: string,
    orderId: string,
    channel: 'email' | 'sms',
    reviewUrl: string,
    delayMinutes = 45,
  ): Promise<IReviewRequestDocument | null> {
    // Check: one per order
    const exists = await this.reviewRepo.existsForOrder(restaurantId, contactId, orderId);
    if (exists) {
      log.debug({ restaurantId, contactId, orderId }, 'Review request already exists for this order');
      return null;
    }

    // Check cooldown
    const contact = await this.contactRepo.findById(restaurantId, contactId);
    if (!contact) return null;

    const cooldownCheck = checkReviewCooldown(contact.lastReviewRequestAt);
    if (!cooldownCheck.allowed) {
      log.debug({ restaurantId, contactId, reason: cooldownCheck.reason }, 'Review cooldown active');
      return null;
    }

    // Schedule
    const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);

    const request = await this.reviewRepo.create({
      restaurantId,
      contactId,
      orderId,
      channel,
      status: 'scheduled',
      scheduledAt,
      reviewUrl,
    } as any);

    // Update contact's last review request timestamp
    await this.contactRepo.updateById(restaurantId, contactId, {
      $set: { lastReviewRequestAt: new Date() },
    });

    log.info({ restaurantId, contactId, orderId, scheduledAt }, 'Review request scheduled');
    return request;
  }

  /**
   * Find review requests ready to send (used by scheduler).
   */
  async findReadyToSend(): Promise<IReviewRequestDocument[]> {
    return this.reviewRepo.findReadyToSend();
  }

  /**
   * Mark a review request as sent.
   */
  async markSent(requestId: string, restaurantId: string): Promise<void> {
    await this.reviewRepo.updateById(restaurantId, requestId, {
      $set: { status: 'sent', sentAt: new Date() },
    });
  }

  /**
   * Mark a review request as clicked.
   */
  async markClicked(requestId: string, restaurantId: string): Promise<void> {
    await this.reviewRepo.updateById(restaurantId, requestId, {
      $set: { status: 'clicked', clickedAt: new Date() },
    });
  }
}
