/**
 * @fileoverview Communication Service — sends emails and SMS via providers.
 *
 * Handles:
 * - Template resolution and variable interpolation
 * - Sending via the configured provider (email/SMS)
 * - Logging all communications to crm_communication_logs
 * - Link tracking URL generation
 *
 * @module services/CommunicationService
 */

import { v4 as uuidv4 } from 'uuid';
import { getEmailProvider } from '../factories/EmailProviderFactory.js';
import { getSMSProvider } from '../factories/SMSProviderFactory.js';
import { TemplateRepository } from '../repositories/TemplateRepository.js';
import { CommunicationLogRepository } from '../repositories/CommunicationLogRepository.js';
import { LinkTrackingRepository } from '../repositories/LinkTrackingRepository.js';
import type { ICommunicationLogDocument } from '../domain/models/crm/CommunicationLog.js';
import { interpolate, type InterpolationContext } from '../utils/variableInterpolator.js';
import { withRetry } from '../utils/retryHelper.js';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('CommunicationService');

/** Parameters for sending an email */
export interface SendEmailParams {
  restaurantId: string;
  contactId: string;
  to: string;
  templateId?: string;
  subject?: string;
  body?: string;
  context: InterpolationContext;
  flowId?: string;
  executionId?: string;
}

/** Parameters for sending an SMS */
export interface SendSMSParams {
  restaurantId: string;
  contactId: string;
  to: string;
  templateId?: string;
  body?: string;
  context: InterpolationContext;
  flowId?: string;
  executionId?: string;
}

export class CommunicationService {
  private readonly templateRepo: TemplateRepository;
  private readonly commLogRepo: CommunicationLogRepository;
  private readonly linkTrackingRepo: LinkTrackingRepository;

  constructor() {
    this.templateRepo = new TemplateRepository();
    this.commLogRepo = new CommunicationLogRepository();
    this.linkTrackingRepo = new LinkTrackingRepository();
  }

  /**
   * Send an email to a contact.
   *
   * @param params - Email parameters
   * @returns The communication log record
   */
  async sendEmail(params: SendEmailParams): Promise<ICommunicationLogDocument> {
    let subject = params.subject ?? '';
    let body = params.body ?? '';

    // Load template if specified
    if (params.templateId) {
      const template = await this.templateRepo.findById(params.restaurantId, params.templateId);
      if (template) {
        subject = template.subject ?? subject;
        body = template.body ?? body;
      }
    }

    // Interpolate variables
    subject = interpolate(subject, params.context);
    body = interpolate(body, params.context);

    // Create communication log (queued)
    const commLog = await this.commLogRepo.create({
      restaurantId: params.restaurantId,
      contactId: params.contactId,
      channel: 'email',
      templateId: params.templateId ?? null,
      flowId: params.flowId ?? null,
      executionId: params.executionId ?? null,
      to: params.to,
      subject,
      status: 'queued',
      sentAt: new Date(),
    } as any);

    // Send via provider with retry
    try {
      const provider = getEmailProvider();
      const result = await withRetry(
        () =>
          provider.sendEmail({
            to: params.to,
            from: env.EMAIL_FROM_ADDRESS ?? `noreply@${env.EMAIL_DOMAIN}`,
            subject,
            html: body,
            metadata: {
              communicationLogId: commLog._id.toString(),
              contactId: params.contactId,
            },
          }),
        { maxAttempts: 3, operationName: 'send_email' },
      );

      await this.commLogRepo.updateStatus(commLog._id, 'sent');
      if (result.messageId) {
        await this.commLogRepo.updateById(params.restaurantId, commLog._id.toString(), {
          $set: { providerMessageId: result.messageId },
        });
      }
      log.info({ to: params.to, messageId: result.messageId }, 'Email sent');
    } catch (err) {

      await this.commLogRepo.updateStatus(commLog._id, 'failed');
      log.error({ err, to: params.to }, 'Email send failed after retries');
      throw err;
    }

    return commLog;
  }

  /**
   * Send an SMS to a contact.
   */
  async sendSMS(params: SendSMSParams): Promise<ICommunicationLogDocument> {
    let body = params.body ?? '';

    // Load template if specified
    if (params.templateId) {
      const template = await this.templateRepo.findById(params.restaurantId, params.templateId);
      if (template) {
        body = template.body ?? body;
      }
    }

    // Interpolate variables
    body = interpolate(body, params.context);

    // Create communication log
    const commLog = await this.commLogRepo.create({
      restaurantId: params.restaurantId,
      contactId: params.contactId,
      channel: 'sms',
      templateId: params.templateId ?? null,
      flowId: params.flowId ?? null,
      executionId: params.executionId ?? null,
      to: params.to,
      subject: null,
      status: 'queued',
      sentAt: new Date(),
    } as any);

    // Send via provider with retry
    try {
      const provider = getSMSProvider();
      const result = await withRetry(
        () =>
          provider.sendSMS({
            to: params.to,
            body,
            metadata: {
              communicationLogId: commLog._id.toString(),
              contactId: params.contactId,
            },
          }),
        { maxAttempts: 3, operationName: 'send_sms' },
      );

      await this.commLogRepo.updateStatus(commLog._id, 'sent');
      if (result.messageId) {
        await this.commLogRepo.updateById(params.restaurantId, commLog._id.toString(), {
          $set: { providerMessageId: result.messageId },
        });
      }
      log.info({ to: params.to, messageId: result.messageId }, 'SMS sent');
    } catch (err) {
      await this.commLogRepo.updateStatus(commLog._id, 'failed');
      log.error({ err, to: params.to }, 'SMS send failed after retries');
    }

    return commLog;
  }

  /**
   * Create a tracking URL for a link in an email/SMS.
   */
  async createTrackingUrl(
    communicationLogId: string,
    contactId: string,
    originalUrl: string,
  ): Promise<string> {
    const trackingId = uuidv4().replace(/-/g, '').slice(0, 12);
    const trackingUrl = `/t/${trackingId}`;

    await this.linkTrackingRepo.create({
      communicationLogId,
      contactId,
      originalUrl,
      trackingUrl,
      clickCount: 0,
    } as any);

    return trackingUrl;
  }

  /**
   * Record a link click and return the original URL for redirect.
   */
  async recordLinkClick(trackingUrl: string): Promise<string | null> {
    const link = await this.linkTrackingRepo.recordClick(trackingUrl);
    return link?.originalUrl ?? null;
  }
}
