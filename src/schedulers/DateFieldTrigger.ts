/**
 * @fileoverview Date Field Trigger — daily cron that checks date-field-based triggers.
 *
 * Runs: daily at midnight (per restaurant timezone)
 *
 * Checks contacts with date fields matching today (birthday, anniversary, etc.)
 * and enrolls them in matching flows.
 *
 * @module schedulers/DateFieldTrigger
 */

import cron from 'node-cron';
import { FlowRepository } from '../repositories/FlowRepository.js';
import { ContactRepository } from '../repositories/ContactRepository.js';
import { TriggerService } from '../services/TriggerService.js';
import { StoreHours } from '../domain/models/external/StoreHours.js';
import { Restaurant } from '../domain/models/external/Restaurant.js';
import { getNowInTimezone } from '../utils/timezoneHelper.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('DateFieldTrigger');

export class DateFieldTrigger {
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
    // Daily at midnight UTC — each restaurant checked with its own timezone
    this.task = cron.schedule('0 0 * * *', async () => {
      try {
        await this.run();
      } catch (err) {
        log.error({ err }, 'Date field trigger failed');
      }
    });

    log.info('Date field trigger scheduled (daily at midnight)');
  }

  async run(): Promise<void> {
    log.info('Running date field trigger check...');

    const restaurants = await Restaurant.find({}).lean().exec();

    for (const restaurant of restaurants) {
      const restaurantId = restaurant._id.toString();

      try {
        // Get restaurant timezone
        const storeHours = await StoreHours.findOne({ restaurantId: restaurant._id }).lean().exec();
        const timezone = storeHours?.timezone ?? 'UTC';
        const now = getNowInTimezone(timezone);

        // Only process if it's near midnight in the restaurant's timezone
        if (now.hours > 1) continue; // Already past midnight in their TZ

        const today = `${now.month.toString().padStart(2, '0')}-${now.day.toString().padStart(2, '0')}`;

        // Find flows with date_field_trigger
        const flows = await this.flowRepo.findActiveByTrigger(restaurantId, 'date_field');

        for (const flow of flows) {
          const triggerNode = flow.nodes.find(
            (n) => n.type === 'trigger' && n.subType === 'date_field',
          );
          if (!triggerNode) continue;

          const dateField = triggerNode.config.dateField as string;
          if (!dateField) continue;

          // Find contacts where the date field's month-day matches today
          const contacts = await this.contactRepo.find(restaurantId);

          for (const contact of contacts) {
            const dateValue = contact.customFields?.[dateField] as string | Date | null;
            if (!dateValue) continue;

            const date = new Date(dateValue);
            const contactMD = `${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;

            if (contactMD === today) {
              await this.triggerService.evaluateTriggers(
                restaurantId,
                'date_field',
                contact._id.toString(),
                { dateField, dateValue: dateValue.toString() },
              );
            }
          }
        }
      } catch (err) {
        log.error({ err, restaurantId }, 'Date field trigger failed for restaurant');
      }
    }

    log.info('Date field trigger check complete');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      log.info('Date field trigger stopped');
    }
  }
}
