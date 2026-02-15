/**
 * @fileoverview Pino logger configuration.
 *
 * Creates a singleton Pino logger instance used across the entire application.
 * In development, uses `pino-pretty` for human-readable output.
 * In production, outputs structured JSON for log aggregation.
 *
 * @module config/logger
 */

import pino from 'pino';
import { env } from './env.js';

/**
 * Pino transport configuration.
 * Uses pino-pretty in development for readable console output.
 */
const transport =
  env.NODE_ENV === 'development'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      })
    : undefined;

/**
 * Singleton Pino logger instance.
 *
 * Usage:
 * ```ts
 * import { logger } from '@/config/logger.js';
 * logger.info({ orderId }, 'Processing order event');
 * logger.error({ err }, 'Failed to send email');
 * ```
 */
export const logger = pino(
  {
    name: 'oc-crm-engine',
    level: env.LOG_LEVEL,
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  },
  transport,
);

/** Child logger factory for creating module-specific loggers */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}
