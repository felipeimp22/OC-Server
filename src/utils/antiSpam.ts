/**
 * @fileoverview Anti-spam / cooldown rules for messaging.
 *
 * Enforces:
 * - Review request cooldowns (one per X days per contact)
 * - General messaging frequency limits per contact/channel
 * - One review request per order
 *
 * @module utils/antiSpam
 */

import { createLogger } from '../config/logger.js';

const log = createLogger('antiSpam');

/**
 * Default cooldown configuration.
 * Can be overridden per restaurant in the future.
 */
export const DEFAULT_COOLDOWNS = {
  /** Minimum days between review requests to the same contact */
  reviewRequestDays: 7,
  /** Maximum emails per contact per day */
  maxEmailsPerDay: 3,
  /** Maximum SMS per contact per day */
  maxSmsPerDay: 2,
  /** Minimum order value to trigger review request ($) */
  minOrderValueForReview: 0,
} as const;

/**
 * Check if a messaging action is allowed based on frequency limits.
 *
 * @param recentSendCount - Number of messages sent in the current window
 * @param channel - Communication channel
 * @returns Object with `allowed` boolean and optional `reason`
 */
export function checkFrequencyLimit(
  recentSendCount: number,
  channel: 'email' | 'sms',
): { allowed: boolean; reason?: string } {
  const limit = channel === 'email' ? DEFAULT_COOLDOWNS.maxEmailsPerDay : DEFAULT_COOLDOWNS.maxSmsPerDay;

  if (recentSendCount >= limit) {
    const reason = `${channel} frequency limit reached (${recentSendCount}/${limit} per day)`;
    log.info({ channel, recentSendCount, limit }, reason);
    return { allowed: false, reason };
  }

  return { allowed: true };
}

/**
 * Check if a review request should be sent based on anti-spam rules.
 *
 * @param lastReviewRequestAt - Timestamp of the last review request
 * @param cooldownDays - Minimum days between requests
 * @returns Object with `allowed` boolean and optional `reason`
 */
export function checkReviewCooldown(
  lastReviewRequestAt: Date | null,
  cooldownDays: number = DEFAULT_COOLDOWNS.reviewRequestDays,
): { allowed: boolean; reason?: string } {
  if (!lastReviewRequestAt) {
    return { allowed: true };
  }

  const daysSinceLast = (Date.now() - lastReviewRequestAt.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceLast < cooldownDays) {
    const reason = `Review cooldown active (${daysSinceLast.toFixed(1)} / ${cooldownDays} days)`;
    log.debug({ lastReviewRequestAt, daysSinceLast, cooldownDays }, reason);
    return { allowed: false, reason };
  }

  return { allowed: true };
}
