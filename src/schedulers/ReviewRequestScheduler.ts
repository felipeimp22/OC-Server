/**
 * @fileoverview Review Request Scheduler — processes pending review requests.
 *
 * Runs: every 5 minutes
 *
 * Checks for review requests with scheduledAt <= now AND status = "scheduled",
 * then sends them via the CommunicationService.
 *
 * @module schedulers/ReviewRequestScheduler
 */

import cron from 'node-cron';
import { ReviewRequestService } from '../services/ReviewRequestService.js';
import { CommunicationService } from '../services/CommunicationService.js';
import { ContactRepository } from '../repositories/ContactRepository.js';
import { Restaurant } from '../domain/models/external/Restaurant.js';
import { buildContext } from '../utils/variableInterpolator.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('ReviewRequestScheduler');

export class ReviewRequestScheduler {
  private task: cron.ScheduledTask | null = null;
  private readonly reviewService: ReviewRequestService;
  private readonly commService: CommunicationService;
  private readonly contactRepo: ContactRepository;

  constructor() {
    this.reviewService = new ReviewRequestService();
    this.commService = new CommunicationService();
    this.contactRepo = new ContactRepository();
  }

  start(): void {
    // Every 5 minutes
    this.task = cron.schedule('*/5 * * * *', async () => {
      try {
        await this.run();
      } catch (err) {
        log.error({ err }, 'Review request processing failed');
      }
    });

    log.info('Review request scheduler started (every 5 minutes)');
  }

  async run(): Promise<void> {
    const readyRequests = await this.reviewService.findReadyToSend();
    if (readyRequests.length === 0) return;

    log.info({ count: readyRequests.length }, 'Processing review requests');

    for (const request of readyRequests) {
      try {
        const restaurantId = request.restaurantId.toString();
        const contactId = request.contactId.toString();

        // Load contact
        const contact = await this.contactRepo.findById(restaurantId, contactId);
        if (!contact) {
          log.warn({ requestId: request._id, contactId }, 'Contact not found — skipping');
          continue;
        }

        // Load restaurant for context
        const restaurant = await Restaurant.findById(restaurantId).lean().exec();
        const context = await buildContext(
          contact.toObject ? contact.toObject() : contact,
          { review_link: request.reviewUrl },
          (restaurant ?? {}) as Record<string, unknown>,
        );

        if (request.channel === 'sms' && contact.phone) {
          const phoneNum = `${contact.phone.countryCode}${contact.phone.number}`;
          await this.commService.sendSMS({
            restaurantId,
            contactId,
            to: phoneNum,
            body: `Hey {{first_name}} 👋 Thanks for ordering from {{restaurant_name}}! If you enjoyed your meal, we'd really appreciate a quick review: {{review_link}}`,
            context,
          });
        } else if (contact.email) {
          await this.commService.sendEmail({
            restaurantId,
            contactId,
            to: [contact.email],
            subject: `How was your order from {{restaurant_name}}?`,
            body: `Hi {{first_name}}, we hope you enjoyed your order! Please leave us a review: {{review_link}}`,
            context,
          });
        }

        await this.reviewService.markSent(request._id.toString(), restaurantId);
        log.info({ requestId: request._id, contactId, channel: request.channel }, 'Review request sent');
      } catch (err) {
        log.error({ err, requestId: request._id }, 'Failed to send review request');
      }
    }
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      log.info('Review request scheduler stopped');
    }
  }
}
