/**
 * @fileoverview MessageBird SMS provider implementation.
 *
 * Alternative SMS provider using MessageBird's REST API.
 *
 * @module providers/sms/MessageBirdProvider
 */

import axios from 'axios';
import { createLogger } from '../../config/logger.js';
import type { ISMSProvider, ISMSOptions, ISMSSendResult } from '../../domain/interfaces/ICommunicationProvider.js';

const log = createLogger('MessageBirdProvider');

export class MessageBirdProvider implements ISMSProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async initialize(_config: Record<string, unknown>): Promise<void> {
    // No-op: configuration provided via constructor
  }

  getProviderName(): string {
    return 'messagebird';
  }

  /**
   * Send an SMS via MessageBird's Messages API.
   */
  async sendSMS(options: ISMSOptions): Promise<ISMSSendResult> {
    const payload = {
      originator: options.from ?? 'OrderChop',
      recipients: [options.to],
      body: options.body,
    };

    const response = await axios.post('https://rest.messagebird.com/messages', payload, {
      headers: {
        Authorization: `AccessKey ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    const messageId = response.data?.id ?? '';
    log.info({ to: options.to, messageId }, 'SMS sent via MessageBird');

    return { messageId, status: 'sent', timestamp: new Date() };
  }
}
