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
import { TemplateRepository } from '../repositories/TemplateRepository.js';
import { CommunicationLogRepository } from '../repositories/CommunicationLogRepository.js';
import { ContactRepository } from '../repositories/ContactRepository.js';
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
  /** Resolved recipient email addresses */
  to: string[];
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
  private readonly contactRepo: ContactRepository;
  private readonly linkTrackingRepo: LinkTrackingRepository;

  constructor() {
    this.templateRepo = new TemplateRepository();
    this.commLogRepo = new CommunicationLogRepository();
    this.contactRepo = new ContactRepository();
    this.linkTrackingRepo = new LinkTrackingRepository();
  }

  /**
   * Interpolate template variables in a string.
   * Exported as a static method for use by WebhookService and other services.
   *
   * @param template - Template string with {{variable}} or {{object.field}} placeholders
   * @param context - Interpolation context (flat or nested)
   * @returns Interpolated string
   */
  static interpolate(template: string, context: InterpolationContext): string {
    return interpolate(template, context);
  }

  /**
   * Send an email to one or more recipients.
   *
   * @param params - Email parameters including resolved to[] addresses
   * @returns The communication log record
   */
  async sendEmail(params: SendEmailParams): Promise<ICommunicationLogDocument> {
    // Validate recipients
    const validTo = params.to.filter(Boolean);
    if (validTo.length === 0) {
      log.info({ contactId: params.contactId }, 'No email recipients — skipping send');
      return this.commLogRepo.create({
        restaurantId: params.restaurantId,
        contactId: params.contactId,
        channel: 'email',
        templateId: params.templateId ?? null,
        flowId: params.flowId ?? null,
        executionId: params.executionId ?? null,
        to: '',
        subject: params.subject ?? '',
        status: 'skipped',
        reason: 'no_email',
        sentAt: new Date(),
      } as any);
    }

    // Check email opt-in status
    const contact = await this.contactRepo.findById(params.restaurantId, params.contactId);
    log.debug({ contactId: params.contactId, emailOptIn: contact?.emailOptIn }, 'Email opt-in check');
    if (contact && contact.emailOptIn === false) {
      log.info({ contactId: params.contactId }, 'Contact opted out — skipping email send');
      return this.commLogRepo.create({
        restaurantId: params.restaurantId,
        contactId: params.contactId,
        channel: 'email',
        templateId: params.templateId ?? null,
        flowId: params.flowId ?? null,
        executionId: params.executionId ?? null,
        to: validTo.join(', '),
        subject: params.subject ?? '',
        status: 'skipped',
        reason: 'opted_out',
        sentAt: new Date(),
      } as any);
    }

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

    // Interpolate variables (supports {{customer.first_name}} dot-notation)
    subject = interpolate(subject, params.context);
    body = interpolate(body, params.context);

    const toStr = validTo.join(', ');

    // Create communication log (queued)
    const commLog = await this.commLogRepo.create({
      restaurantId: params.restaurantId,
      contactId: params.contactId,
      channel: 'email',
      templateId: params.templateId ?? null,
      flowId: params.flowId ?? null,
      executionId: params.executionId ?? null,
      to: toStr,
      subject,
      status: 'queued',
      sentAt: new Date(),
    } as any);

    log.debug({ to: toStr, subject, bodyLength: body.length }, 'Sending CRM email');

    // Send via provider with retry (max 3 attempts)
    try {
      const provider = getEmailProvider();
      const result = await withRetry(
        () =>
          provider.sendEmail({
            to: validTo,
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
      log.info({ contactId: params.contactId, to: toStr, subject }, 'CRM email sent successfully');
    } catch (err) {
      const errorMessage = (err as Error).message;
      await this.commLogRepo.updateStatus(commLog._id, 'failed');
      log.error({ contactId: params.contactId, to: toStr, subject, error: errorMessage }, 'CRM email send failed');
    }

    return commLog;
  }

  /**
   * Send an SMS to a contact.
   * Currently a stub — logs skipped with reason 'sms_stub'. No real send occurs.
   */
  async sendSMS(params: SendSMSParams): Promise<ICommunicationLogDocument> {
    log.info({ contactId: params.contactId, to: params.to }, 'SMS send stubbed — skipping');
    return this.commLogRepo.create({
      restaurantId: params.restaurantId,
      contactId: params.contactId,
      channel: 'sms',
      templateId: params.templateId ?? null,
      flowId: params.flowId ?? null,
      executionId: params.executionId ?? null,
      to: params.to,
      subject: null,
      status: 'skipped',
      reason: 'sms_stub',
      sentAt: new Date(),
    } as any);
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
