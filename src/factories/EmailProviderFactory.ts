/**
 * @fileoverview Email provider factory (singleton pattern).
 *
 * Creates the appropriate email provider based on the EMAIL_PROVIDER env var.
 * Mirrors the OrderChop factory pattern.
 *
 * @module factories/EmailProviderFactory
 */

import { env } from '../config/env.js';
import type { IEmailProvider } from '../domain/interfaces/ICommunicationProvider.js';
import { MailgunProvider } from '../providers/email/MailgunProvider.js';
import { SendGridProvider } from '../providers/email/SendGridProvider.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('EmailProviderFactory');

let instance: IEmailProvider | null = null;

/**
 * Get the singleton email provider instance.
 * Lazily created on first call based on EMAIL_PROVIDER env var.
 *
 * @returns The configured email provider
 * @throws If required env vars are missing
 */
export function getEmailProvider(): IEmailProvider {
  if (instance) return instance;

  switch (env.EMAIL_PROVIDER) {
    case 'mailgun': {
      if (!env.EMAIL_API_KEY || !env.EMAIL_DOMAIN) {
        throw new Error('Mailgun requires EMAIL_API_KEY and EMAIL_DOMAIN');
      }
      instance = new MailgunProvider(env.EMAIL_API_KEY, env.EMAIL_DOMAIN);
      log.info('Email provider: Mailgun');
      break;
    }
    case 'sendgrid': {
      if (!env.EMAIL_API_KEY) {
        throw new Error('SendGrid requires EMAIL_API_KEY');
      }
      instance = new SendGridProvider(env.EMAIL_API_KEY);
      log.info('Email provider: SendGrid');
      break;
    }
    default:
      throw new Error(`Unknown email provider: ${env.EMAIL_PROVIDER}`);
  }

  return instance;
}
