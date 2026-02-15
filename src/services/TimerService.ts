/**
 * @fileoverview Timer Service — manages timer/delay nodes in flows.
 *
 * Handles:
 * - Simple delays (duration + unit)
 * - Date-based timers (contact date field + offset)
 * - Advanced timers (delay + weekday + time + timezone constraints)
 *
 * Timer nodes pause the flow execution and schedule a BullMQ delayed job.
 * When the job fires, the FlowTimerProcessor resumes the execution.
 *
 * @module services/TimerService
 */

import { Queue } from 'bullmq';
import type { IFlowNode } from '../domain/models/crm/Flow.js';
import type { IContactDocument } from '../domain/models/crm/Contact.js';
import { FlowExecutionRepository } from '../repositories/FlowExecutionRepository.js';
import {
  calculateDelayTarget,
  calculateAdvancedTimerTarget,
  calculateDateFieldTarget,
} from '../utils/timezoneHelper.js';
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
   * @param contact - The CRM contact (for date field resolution)
   * @param executionId - Flow execution ID
   * @param timezone - Restaurant timezone
   * @returns The target execution time, or null if timer could not be scheduled
   */
  async scheduleTimer(
    node: IFlowNode,
    contact: IContactDocument,
    executionId: string,
    timezone: string,
  ): Promise<Date | null> {
    let targetDate: Date | null = null;

    switch (node.subType) {
      case 'delay':
        targetDate = this.calculateDelay(node);
        break;
      case 'date':
        targetDate = this.calculateDateTimer(node, contact);
        break;
      case 'advanced':
        targetDate = this.calculateAdvancedTimer(node, timezone);
        break;
      default:
        log.warn({ subType: node.subType }, 'Unknown timer subType');
        return null;
    }

    if (!targetDate || targetDate <= new Date()) {
      log.warn({ executionId, nodeId: node.id, targetDate }, 'Timer target is in the past — executing immediately');
      return new Date(); // Will be processed immediately
    }

    // Update execution with nextExecutionAt
    await this.executionRepo.scheduleTimer(executionId, targetDate);

    // Schedule BullMQ delayed job
    const delayMs = targetDate.getTime() - Date.now();

    if (!this.timerQueue) {
      log.warn({ executionId, nodeId: node.id }, 'Timer queue not available — Redis disabled');
      return targetDate;
    }

    await this.timerQueue.add(
      'flow-timer',
      { executionId, nodeId: node.id },
      {
        delay: delayMs,
        jobId: `timer-${executionId}-${node.id}`,
        removeOnComplete: true,
        removeOnFail: 100, // Keep last 100 failed jobs for debugging
      },
    );

    log.info(
      { executionId, nodeId: node.id, targetDate, delayMs },
      'Timer scheduled',
    );

    return targetDate;
  }

  /**
   * Calculate target for a simple delay timer.
   * Config: { duration: number, unit: "minutes"|"hours"|"days" }
   */
  private calculateDelay(node: IFlowNode): Date {
    const { duration, unit } = node.config as { duration: number; unit: 'minutes' | 'hours' | 'days' };
    return calculateDelayTarget(duration, unit);
  }

  /**
   * Calculate target for a date field timer.
   * Config: { dateField: string, offsetDays: number }
   */
  private calculateDateTimer(node: IFlowNode, contact: IContactDocument): Date | null {
    const { dateField, offsetDays } = node.config as { dateField: string; offsetDays: number };

    // Resolve the date field from custom fields or contact properties
    const contactObj = contact.toObject ? contact.toObject() : contact;
    const dateValue =
      (contact.customFields?.[dateField] as string | Date) ??
      (contactObj as Record<string, unknown>)[dateField] as string | Date | null;

    return calculateDateFieldTarget(dateValue as string | Date | null, offsetDays ?? 0);
  }

  /**
   * Calculate target for an advanced timer.
   * Config: { delay, unit, weekdays, time, timezone }
   */
  private calculateAdvancedTimer(node: IFlowNode, timezone: string): Date {
    const config = node.config as {
      delay: number;
      unit: 'minutes' | 'hours' | 'days';
      weekdays?: number[];
      time?: string;
    };

    return calculateAdvancedTimerTarget({
      ...config,
      timezone,
    });
  }
}
