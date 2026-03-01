/**
 * @fileoverview Timer Service — manages timer/delay nodes in flows.
 *
 * Handles:
 * - Simple delays (duration + unit)
 * - Date-based timers (targetDateUtc from node config)
 *
 * Timer nodes pause the flow execution and schedule a BullMQ delayed job.
 * When the job fires, the FlowTimerProcessor resumes the execution.
 *
 * @module services/TimerService
 */

import { Queue } from 'bullmq';
import type { IFlowNode } from '../domain/models/crm/Flow.js';
import { FlowExecutionRepository } from '../repositories/FlowExecutionRepository.js';
import { timezoneService } from './TimezoneService.js';
import { calculateDelayTarget } from '../utils/timezoneHelper.js';
import { redis } from '../config/redis.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('TimerService');

/** BullMQ queue name for flow timers */
export const FLOW_TIMER_QUEUE = 'flow-timers';

export class TimerService {
  private readonly executionRepo: FlowExecutionRepository;
  private readonly timerQueue: Queue | null;

  constructor() {
    this.executionRepo = new FlowExecutionRepository();
    this.timerQueue = redis ? new Queue(FLOW_TIMER_QUEUE, { connection: redis }) : null;
  }

  /**
   * Schedule a timer step. Pauses the flow execution and schedules
   * a BullMQ delayed job.
   *
   * @param node - The timer node
   * @param executionId - Flow execution ID
   * @param restaurantId - Restaurant ID (used to fetch timezone for logging)
   * @returns { targetDate: Date } on success, or null on failure (treat as 0-delay)
   */
  async scheduleTimer(
    node: IFlowNode,
    executionId: string,
    restaurantId: string,
  ): Promise<{ targetDate: Date } | null> {
    const timezone = await timezoneService.getTimezone(restaurantId);
    let targetDate: Date | null = null;

    switch (node.subType) {
      case 'delay':
        targetDate = this.calculateDelay(node);
        break;

      case 'date_field': {
        const { targetDateUtc } = node.config as { targetDateUtc?: string };
        if (!targetDateUtc) {
          log.warn({ executionId, nodeId: node.id }, 'date_field timer missing targetDateUtc — treating as 0-delay');
          return null;
        }
        const d = new Date(targetDateUtc);
        if (isNaN(d.getTime())) {
          log.warn({ executionId, nodeId: node.id, targetDateUtc }, 'Invalid targetDateUtc — treating as 0-delay');
          return null;
        }
        if (d <= new Date()) {
          log.warn(
            { executionId, nodeId: node.id, targetDateUtc, timezone },
            'date_field target is in the past — treating as 0-delay',
          );
          return null;
        }
        targetDate = d;
        break;
      }

      default:
        log.error({ subType: node.subType }, 'Unsupported timer subType — non-blocking');
        return null;
    }

    if (!targetDate) {
      return null;
    }

    log.info({ executionId, nodeId: node.id, targetDate, timezone }, 'Scheduling timer');

    // Update execution with nextExecutionAt
    await this.executionRepo.scheduleTimer(executionId, targetDate);

    // Schedule BullMQ delayed job
    const delayMs = targetDate.getTime() - Date.now();

    if (!this.timerQueue) {
      log.warn({ executionId, nodeId: node.id }, 'Timer queue not available — Redis disabled');
      return { targetDate };
    }

    await this.timerQueue.add(
      'flow-timer',
      { executionId, nodeId: node.id },
      {
        delay: delayMs,
        jobId: `timer-${executionId}-${node.id}`,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    log.info({ executionId, nodeId: node.id, targetDate, delayMs }, 'Timer scheduled');

    return { targetDate };
  }

  /**
   * Calculate target for a simple delay timer.
   * Config: { duration: number, unit: "minutes"|"hours"|"days" }
   */
  private calculateDelay(node: IFlowNode): Date {
    const { duration, unit } = node.config as { duration: number; unit: 'minutes' | 'hours' | 'days' };
    return calculateDelayTarget(duration, unit);
  }
}
