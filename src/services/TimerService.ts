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
   * @returns { targetDate: Date } on success, or null on failure
   */
  async scheduleTimer(
    node: IFlowNode,
    contact: IContactDocument,
    executionId: string,
    timezone: string,
  ): Promise<{ targetDate: Date } | null> {
    let targetDate: Date | null = null;

    switch (node.subType) {
      case 'delay':
        targetDate = this.calculateDelay(node);
        break;
      case 'date_field':
        targetDate = this.calculateDateFieldTimer(node, contact);
        break;
      case 'smart_date_sequence':
        targetDate = this.calculateSmartDateSequence(node, timezone);
        break;
      default:
        log.warn({ subType: node.subType }, 'Unknown timer subType');
        return null;
    }

    if (!targetDate || targetDate <= new Date()) {
      log.warn({ executionId, nodeId: node.id, targetDate }, 'Timer target is in the past — skipping');
      return null;
    }

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

  /**
   * Calculate target for a date_field timer.
   * Config: { field: string, offsetDays?: number }
   * Skips (returns null) if field is missing or the target date is in the past.
   */
  private calculateDateFieldTimer(node: IFlowNode, contact: IContactDocument): Date | null {
    const { field, offsetDays } = node.config as { field: string; offsetDays?: number };

    if (!field) return null;

    // Resolve the date field from custom fields or contact properties
    const contactObj = (contact.toObject ? contact.toObject() : contact) as Record<string, unknown>;
    const dateValue =
      (contact.customFields?.[field] as string | Date | undefined) ??
      (contactObj[field] as string | Date | undefined) ??
      null;

    const result = calculateDateFieldTarget(dateValue as string | Date | null, offsetDays ?? 0);

    // Skip if date is in the past
    if (!result || result <= new Date()) return null;

    return result;
  }

  /**
   * Calculate target for a smart_date_sequence timer.
   * Config: { weekday?: number, time?: string } — next occurrence of weekday+time in timezone.
   */
  private calculateSmartDateSequence(node: IFlowNode, timezone: string): Date {
    const config = node.config as {
      weekday?: number;
      weekdays?: number[];
      time?: string;
      delay?: number;
      unit?: 'minutes' | 'hours' | 'days';
    };

    return calculateAdvancedTimerTarget({
      delay: config.delay ?? 0,
      unit: config.unit ?? 'days',
      weekdays: config.weekdays ?? (config.weekday !== undefined ? [config.weekday] : undefined),
      time: config.time,
      timezone,
    });
  }
}
