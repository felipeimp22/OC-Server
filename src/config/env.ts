/**
 * @fileoverview Zod-validated environment variable schema.
 *
 * All environment variables are validated at startup. If any required variable
 * is missing or invalid, the process exits immediately with a descriptive error.
 *
 * Environment variables marked [SHARED] must match the corresponding value
 * in the OrderChop Next.js app's `.env.local`.
 *
 * @module config/env
 */

import 'dotenv/config';
import { z } from 'zod';

/**
 * Zod schema defining all environment variables for the CRM engine.
 * Parsed once at import time — if validation fails, the process crashes
 * with a helpful error message.
 */
const envSchema = z.object({
  // ─── Server ────────────────────────────────────────────────────────
  /** HTTP port for the Fastify server */
  PORT: z.coerce.number().int().positive().default(3001),
  /** Node environment */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Pino log level */
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // ─── Database [SHARED] ────────────────────────────────────────────
  /** MongoDB connection string — same instance as OrderChop */
  MONGODB_URI: z.string().url().startsWith('mongodb'),

  // ─── Kafka ─────────────────────────────────────────────────────────
  /** Comma-separated Kafka broker addresses */
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  /** Kafka client ID */
  KAFKA_CLIENT_ID: z.string().default('oc-crm-engine'),
  /** Kafka consumer group */
  KAFKA_CONSUMER_GROUP: z.string().default('crm-engine-group'),

  // ─── Redis (BullMQ) ───────────────────────────────────────────────
  /** Redis connection URL for BullMQ job queues */
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // ─── Auth [SHARED] ────────────────────────────────────────────────
  /** Shared NextAuth secret — used to verify JWTs issued by OrderChop */
  AUTH_SECRET: z.string().min(1),

  // ─── Email Provider ────────────────────────────────────────────────
  /** Email provider name */
  EMAIL_PROVIDER: z.enum(['mailgun', 'sendgrid']).default('mailgun'),
  /** Email sending domain (e.g., "go.orderchop.co") */
  EMAIL_DOMAIN: z.string().optional(),
  /** Email provider API key */
  EMAIL_API_KEY: z.string().optional(),
  /** "From" name for outgoing emails */
  EMAIL_FROM_NAME: z.string().default('OrderChop'),
  /** "From" email address (noreply) */
  EMAIL_FROM_ADDRESS: z.string().email().optional(),

  // ─── SMS Provider ──────────────────────────────────────────────────
  /** SMS provider name */
  SMS_PROVIDER: z.enum(['twilio', 'messagebird']).default('twilio'),
  /** Twilio Account SID */
  TWILIO_ACCOUNT_SID: z.string().optional(),
  /** Twilio Auth Token */
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** Twilio sender phone number */
  TWILIO_FROM_NUMBER: z.string().optional(),

  // ─── Meta / Facebook ───────────────────────────────────────────────
  /** Meta Pixel ID for server-side events */
  META_PIXEL_ID: z.string().optional(),
  /** Meta Conversions API access token */
  META_ACCESS_TOKEN: z.string().optional(),

  // ─── Feature flags ─────────────────────────────────────────────────
  /** Enable Kafka consumers (disable for isolated API testing) */
  ENABLE_KAFKA: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  /** Enable BullMQ scheduled jobs */
  ENABLE_SCHEDULERS: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
});

/** Inferred TypeScript type from the Zod schema */
export type Env = z.infer<typeof envSchema>;

/**
 * Parsed and validated environment variables.
 *
 * @throws {z.ZodError} If any required env var is missing or invalid.
 *         The error is caught in the `parseEnv` function and re-thrown
 *         with a human-readable message.
 */
function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(`\n❌ Invalid environment variables:\n${formatted}\n`);
    process.exit(1);
  }
  return result.data;
}

/** Singleton validated environment — access via `env.PORT`, `env.MONGODB_URI`, etc. */
export const env: Env = parseEnv();
