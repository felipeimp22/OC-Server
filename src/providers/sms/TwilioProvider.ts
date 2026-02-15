/**
 * @fileoverview Twilio SMS provider implementation.
 *
 * Uses Twilio's REST API to send SMS messages.
 *
 * @module providers/sms/TwilioProvider
 */

import axios from 'axios';
import { createLogger } from '../../config/logger.js';
import type { ISMSProvider, ISMSOptions, ISMSSendResult } from '../../domain/interfaces/ICommunicationProvider.js';

const log = createLogger('TwilioProvider');

export class TwilioProvider implements ISMSProvider {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;
  private readonly baseUrl: string;

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
    this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
  }

  async initialize(_config: Record<string, unknown>): Promise<void> {
    // No-op: configuration provided via constructor
  }

  getProviderName(): string {
    return 'twilio';
  }

  /**
   * Send an SMS via Twilio's Messages API.
   */
  async sendSMS(options: ISMSOptions): Promise<ISMSSendResult> {
    const formData = new URLSearchParams();
    formData.append('To', options.to);
    formData.append('From', options.from ?? this.fromNumber);
    formData.append('Body', options.body);

    if (options.metadata?.statusCallbackUrl) {
      formData.append('StatusCallback', String(options.metadata.statusCallbackUrl));
    }

    const response = await axios.post(`${this.baseUrl}/Messages.json`, formData, {
      auth: { username: this.accountSid, password: this.authToken },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    });

    const messageId = response.data?.sid ?? '';
    log.info({ to: options.to, messageId }, 'SMS sent via Twilio');

    return {
      messageId,
      status: 'sent',
      timestamp: new Date(),
      segments: response.data?.num_segments ? Number(response.data.num_segments) : undefined,
    };
  }
}
