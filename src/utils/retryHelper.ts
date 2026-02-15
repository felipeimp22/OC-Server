/**
 * @fileoverview Exponential backoff retry helper.
 *
 * Used for retrying failed external calls (email/SMS sends, webhooks).
 * Max 3 attempts with exponential backoff: 1s → 2s → 4s.
 *
 * @module utils/retryHelper
 */

import { createLogger } from '../config/logger.js';

const log = createLogger('retryHelper');

/** Options for the retry function */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Operation name for logging */
  operationName?: string;
}

/**
 * Execute a function with exponential backoff retry.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns The result of the function
 * @throws The last error if all attempts fail
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => emailProvider.send(email),
 *   { maxAttempts: 3, operationName: 'send_email' },
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    backoffMultiplier = 2,
    operationName = 'operation',
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= maxAttempts) {
        log.error(
          { err: lastError, attempt, maxAttempts, operationName },
          `${operationName} failed after ${maxAttempts} attempts`,
        );
        throw lastError;
      }

      const delayMs = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
      log.warn(
        { err: lastError, attempt, maxAttempts, delayMs, operationName },
        `${operationName} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Unreachable, but TypeScript needs it
  throw lastError;
}
