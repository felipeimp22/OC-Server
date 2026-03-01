/**
 * @fileoverview Mailgun email provider implementation.
 *
 * Mirrors the OrderChop pattern: uses Mailgun's HTTP API (v3) via axios.
 * Supports HTML email sending with delivery tracking.
 *
 * @module providers/email/MailgunProvider
 */

import axios from 'axios';
import { createLogger } from '../../config/logger.js';
import type { IEmailProvider, IEmailOptions, IEmailSendResult } from '../../domain/interfaces/ICommunicationProvider.js';

const log = createLogger('MailgunProvider');

export class MailgunProvider implements IEmailProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, domain: string) {
    this.apiKey = apiKey;
    this.baseUrl = `https://api.mailgun.net/v3/${domain}`;
  }

  async initialize(_config: Record<string, unknown>): Promise<void> {
    // No-op: configuration provided via constructor
  }

  getProviderName(): string {
    return 'mailgun';
  }

  /**
   * Send an email via Mailgun's Messages API.
   */
  async sendEmail(options: IEmailOptions): Promise<IEmailSendResult> {
    const to = Array.isArray(options.to) ? options.to.join(', ') : options.to;
    const subject = options.subject;

    const formData = new URLSearchParams();
    formData.append('from', options.from ?? 'noreply@orderchop.com');
    formData.append('to', to);
    formData.append('subject', subject);
    formData.append('html', options.html);

    if (options.text) formData.append('text', options.text);
    if (options.replyTo) formData.append('h:Reply-To', options.replyTo);

    if (options.metadata) {
      for (const [key, value] of Object.entries(options.metadata)) {
        formData.append(`v:${key}`, String(value));
      }
    }

    try {
      const response = await axios.post(`${this.baseUrl}/messages`, formData, {
        auth: { username: 'api', password: this.apiKey },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10_000,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      const messageId = response.data?.id ?? '';
      log.info({ to, messageId }, 'Email sent via Mailgun');

      return { messageId, status: 'sent', timestamp: new Date() };
    } catch (err) {
      // Distinguish HTTP errors (non-2xx response) from network errors
      const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
      if (axiosErr.response) {
        const statusCode = axiosErr.response.status;
        const responseText = JSON.stringify(axiosErr.response.data ?? '');
        log.error({ to, subject, statusCode, responseText }, 'Mailgun API error');
      } else {
        log.error({ to, subject, error: (err as Error).message }, 'Mailgun send threw exception');
      }
      throw err;
    }
  }

  /**
   * Send multiple emails in bulk.
   */
  async sendBulkEmail(optionsList: IEmailOptions[]): Promise<IEmailSendResult[]> {
    return Promise.all(optionsList.map((o) => this.sendEmail(o)));
  }
}
