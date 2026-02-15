/**
 * @fileoverview SendGrid email provider implementation.
 *
 * Alternative email provider using SendGrid's v3 Mail Send API.
 *
 * @module providers/email/SendGridProvider
 */

import axios from 'axios';
import { createLogger } from '../../config/logger.js';
import type { IEmailProvider, IEmailOptions, IEmailSendResult } from '../../domain/interfaces/ICommunicationProvider.js';

const log = createLogger('SendGridProvider');

export class SendGridProvider implements IEmailProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async initialize(_config: Record<string, unknown>): Promise<void> {
    // No-op: configuration provided via constructor
  }

  getProviderName(): string {
    return 'sendgrid';
  }

  /**
   * Send an email via SendGrid's v3 Mail Send API.
   */
  async sendEmail(options: IEmailOptions): Promise<IEmailSendResult> {
    const toArr = Array.isArray(options.to) ? options.to : [options.to];

    const payload = {
      personalizations: [{ to: toArr.map((email) => ({ email })) }],
      from: { email: options.from ?? 'noreply@orderchop.com' },
      subject: options.subject,
      content: [
        { type: 'text/html', value: options.html },
        ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
      ],
      ...(options.replyTo ? { reply_to: { email: options.replyTo } } : {}),
    };

    const response = await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    const messageId = response.headers['x-message-id'] ?? '';
    log.info({ to: options.to, messageId }, 'Email sent via SendGrid');

    return { messageId, status: 'sent', timestamp: new Date() };
  }

  /**
   * Send multiple emails in bulk.
   */
  async sendBulkEmail(optionsList: IEmailOptions[]): Promise<IEmailSendResult[]> {
    return Promise.all(optionsList.map((o) => this.sendEmail(o)));
  }
}
