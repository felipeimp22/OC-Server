/**
 * @fileoverview SMS provider factory (singleton pattern).
 *
 * Creates the appropriate SMS provider based on the SMS_PROVIDER env var.
 *
 * @module factories/SMSProviderFactory
 */

import { env } from '../config/env.js';
import type { ISMSProvider } from '../domain/interfaces/ICommunicationProvider.js';
import { TwilioProvider } from '../providers/sms/TwilioProvider.js';
import { MessageBirdProvider } from '../providers/sms/MessageBirdProvider.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('SMSProviderFactory');

let instance: ISMSProvider | null = null;

/**
 * Get the singleton SMS provider instance.
 * Lazily created on first call based on SMS_PROVIDER env var.
 *
 * @returns The configured SMS provider
 * @throws If required env vars are missing
 */
export function getSMSProvider(): ISMSProvider {
  if (instance) return instance;

  switch (env.SMS_PROVIDER) {
    case 'twilio': {
      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
        throw new Error('Twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER');
      }
      instance = new TwilioProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER);
      log.info('SMS provider: Twilio');
      break;
    }
    case 'messagebird': {
      // MessageBird uses the EMAIL_API_KEY or a dedicated MESSAGEBIRD_API_KEY
      const apiKey = process.env.MESSAGEBIRD_API_KEY ?? env.EMAIL_API_KEY;
      if (!apiKey) {
        throw new Error('MessageBird requires MESSAGEBIRD_API_KEY');
      }
      instance = new MessageBirdProvider(apiKey);
      log.info('SMS provider: MessageBird');
      break;
    }
    default:
      throw new Error(`Unknown SMS provider: ${env.SMS_PROVIDER}`);
  }

  return instance;
}
