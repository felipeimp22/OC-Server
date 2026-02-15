/**
 * @fileoverview Inactivity Checker — cron job that enrolls inactive contacts in flows.
 *
 * Runs: every hour
 *
 * For each active flow with a "no_order_in_x_days" trigger, queries contacts
 * where lastOrderAt < (now - X days) and enrolls them if not already enrolled.
 *
 * @module schedulers/InactivityChecker
 */

import cron from 'node-cron';
import { FlowRepository } from '../repositories/FlowRepository.js';
import { ContactRepository } from '../repositories/ContactRepository.js';
import { TriggerService } from '../services/TriggerService.js';
import { Restaurant } from '../domain/models/external/Restaurant.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('InactivityChecker');

export class InactivityChecker {
  private task: cron.ScheduledTask | null = null;
  private readonly flowRepo: FlowRepository;
  private readonly contactRepo: ContactRepository;
  private readonly triggerService: TriggerService;

  constructor() {
    this.flowRepo = new FlowRepository();
    this.contactRepo = new ContactRepository();
    this.triggerService = new TriggerService();
  }

  start(): void {
    // Every hour
    this.task = cron.schedule('0 * * * *', async () => {
      try {
        await this.run();
      } catch (err) {
        log.error({ err }, 'Inactivity check failed');
      }
    });

    log.info('Inactivity checker scheduled (every hour)');
  }

  async run(): Promise<void> {
    log.info('Running inactivity check...');

    // Get all restaurants
    const restaurants = await Restaurant.find({}).lean().exec();

    for (const restaurant of restaurants) {
      const restaurantId = restaurant._id.toString();

      try {
        // Find active flows with no_order_in_x_days trigger
        const flows = await this.flowRepo.findActiveByTrigger(restaurantId, 'no_order_in_x_days');

        for (const flow of flows) {
          const triggerNode = flow.nodes.find(
            (n) => n.type === 'trigger' && n.subType === 'no_order_in_x_days',
          );
          if (!triggerNode) continue;

          const days = (triggerNode.config.days as number) ?? 30;
          const inactiveContacts = await this.contactRepo.findInactive(restaurantId, days);

          let enrolledCount = 0;
          for (const contact of inactiveContacts) {
            const results = await this.triggerService.evaluateTriggers(
              restaurantId,
              'no_order_in_x_days',
              contact._id.toString(),
              { days, lastOrderAt: contact.lastOrderAt },
            );
            if (results.some((r) => r.enrolled)) {
              enrolledCount++;
            }
          }

          if (enrolledCount > 0) {
            log.info(
              { restaurantId, flowId: flow._id, enrolledCount },
              'Inactive contacts enrolled',
            );
          }
        }
      } catch (err) {
        log.error({ err, restaurantId }, 'Inactivity check failed for restaurant');
      }
    }

    log.info('Inactivity check complete');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      log.info('Inactivity checker stopped');
    }
  }
}
