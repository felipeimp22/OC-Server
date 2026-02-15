/**
 * @fileoverview Lifecycle Updater — cron job that recalculates contact lifecycle status.
 *
 * Runs: every 6 hours
 *
 * @module schedulers/LifecycleUpdater
 */

import cron from 'node-cron';
import { SegmentationService } from '../services/SegmentationService.js';
import { Restaurant } from '../domain/models/external/Restaurant.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('LifecycleUpdater');

export class LifecycleUpdater {
  private task: cron.ScheduledTask | null = null;
  private readonly segmentationService: SegmentationService;

  constructor() {
    this.segmentationService = new SegmentationService();
  }

  start(): void {
    // Every 6 hours
    this.task = cron.schedule('0 */6 * * *', async () => {
      try {
        await this.run();
      } catch (err) {
        log.error({ err }, 'Lifecycle update failed');
      }
    });

    log.info('Lifecycle updater scheduled (every 6 hours)');
  }

  async run(): Promise<void> {
    log.info('Running lifecycle update...');

    const restaurants = await Restaurant.find({}).lean().exec();

    for (const restaurant of restaurants) {
      const restaurantId = restaurant._id.toString();
      try {
        const updated = await this.segmentationService.recalculateAll(restaurantId);
        if (updated > 0) {
          log.info({ restaurantId, updated }, 'Lifecycle statuses updated');
        }
      } catch (err) {
        log.error({ err, restaurantId }, 'Lifecycle update failed for restaurant');
      }
    }

    log.info('Lifecycle update complete');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      log.info('Lifecycle updater stopped');
    }
  }
}
