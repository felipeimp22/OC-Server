/**
 * @fileoverview MongoDB / Mongoose connection configuration.
 *
 * Connects to the SAME MongoDB Atlas instance as the OrderChop Next.js app.
 * The CRM engine reads existing collections (restaurants, customers, orders)
 * via read-only Mongoose schemas and writes to crm_* collections.
 *
 * Mongoose connection events are logged via Pino.
 *
 * @module config/database
 */

import mongoose from 'mongoose';
import { env } from './env.js';
import { createLogger } from './logger.js';

const log = createLogger('database');

/**
 * Establish a Mongoose connection to MongoDB.
 *
 * Called once at application startup from `src/index.ts`.
 * Registers event listeners for connection lifecycle logging.
 *
 * @throws If the connection fails after all retry attempts.
 */
export async function connectDatabase(): Promise<void> {
  const conn = mongoose.connection;

  conn.on('connected', () => {
    log.info('MongoDB connected');
  });

  conn.on('disconnected', () => {
    log.warn('MongoDB disconnected');
  });

  conn.on('error', (err) => {
    log.error({ err }, 'MongoDB connection error');
  });

  try {
    await mongoose.connect(env.MONGODB_URI, {
      // Connection pool size — tune per expected load
      maxPoolSize: 10,
      minPoolSize: 2,
      // Socket timeout
      socketTimeoutMS: 30_000,
      // Server selection timeout
      serverSelectionTimeoutMS: 10_000,
      // Heartbeat interval
      heartbeatFrequencyMS: 10_000,
    });

    log.info('MongoDB connection established');
  } catch (err) {
    log.fatal({ err }, 'Failed to connect to MongoDB — exiting');
    process.exit(1);
  }
}

/**
 * Gracefully disconnect from MongoDB.
 * Called during application shutdown.
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    log.info('MongoDB disconnected gracefully');
  } catch (err) {
    log.error({ err }, 'Error during MongoDB disconnect');
  }
}
