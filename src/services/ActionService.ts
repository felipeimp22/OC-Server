/**
 * @fileoverview Action Service — executes action nodes in flows.
 *
 * Handles 3 action types: send_email, send_sms, outgoing_webhook.
 *
 * @module services/ActionService
 */

import type { IFlowNode } from '../domain/models/crm/Flow.js';
import type { IContactDocument } from '../domain/models/crm/Contact.js';
import { Restaurant } from '../domain/models/external/Restaurant.js';
import { User } from '../domain/models/external/User.js';
import { CommunicationService } from './CommunicationService.js';
import { buildContext, type InterpolationContext } from '../utils/variableInterpolator.js';
import { withRetry } from '../utils/retryHelper.js';
import axios from 'axios';
import { createLogger } from '../config/logger.js';

const log = createLogger('ActionService');

/** Result of executing an action */
export interface ActionResult {
  success: boolean;
  action: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Recipient descriptor in send_email config */
type EmailRecipient =
  | { type: 'customer' }
  | { type: 'restaurant' }
  | { type: 'staff'; userId: string }
  | { type: 'custom'; email: string };

/** Recipient descriptor in send_sms config */
type SMSRecipient =
  | { type: 'customer' }
  | { type: 'restaurant' }
  | { type: 'custom'; phone: string };

export class ActionService {
  private readonly communicationService: CommunicationService;

  constructor() {
    this.communicationService = new CommunicationService();
  }

  /**
   * Execute an action node.
   *
   * @param node - The action node
   * @param contact - The CRM contact
   * @param restaurantId - Tenant ID
   * @param executionContext - Flow execution context
   * @param executionId - Flow execution ID (for linking comm logs)
   * @param flowId - Flow ID
   * @returns Action result — never throws
   */
  async execute(
    node: IFlowNode,
    contact: IContactDocument,
    restaurantId: string,
    executionContext: Record<string, unknown>,
    executionId: string,
    flowId: string,
  ): Promise<ActionResult> {
    try {
      const restaurantData = (executionContext._restaurant ?? {}) as Record<string, unknown>;
      const orderData = (executionContext._order ?? null) as Record<string, unknown> | null;
      const context = buildContext(
        contact.toObject ? contact.toObject() : contact,
        restaurantData,
        orderData,
        executionContext as Record<string, unknown>,
      );

      switch (node.subType) {
        case 'send_email':
          return await this.executeSendEmail(node, contact, restaurantId, context, executionId, flowId);
        case 'send_sms':
          return await this.executeSendSMS(node, contact, restaurantId, context, executionId, flowId);
        case 'outgoing_webhook':
          return await this.executeWebhook(node, context);
        default:
          log.error({ subType: node.subType }, 'Unsupported action type');
          return { success: false, action: node.subType, error: 'action_not_supported' };
      }
    } catch (err) {
      return { success: false, action: node.subType, error: (err as Error).message };
    }
  }

  private async executeSendEmail(
    node: IFlowNode,
    contact: IContactDocument,
    restaurantId: string,
    context: InterpolationContext,
    executionId: string,
    flowId: string,
  ): Promise<ActionResult> {
    try {
      const recipients = (node.config.recipients ?? []) as EmailRecipient[];
      const resolvedEmails: string[] = [];

      for (const recipient of recipients) {
        if (recipient.type === 'customer') {
          if (contact.email) resolvedEmails.push(contact.email);
        } else if (recipient.type === 'restaurant') {
          const restaurant = await Restaurant.findById(restaurantId).lean();
          if (restaurant?.email) resolvedEmails.push(restaurant.email);
        } else if (recipient.type === 'staff') {
          const user = await User.findById(recipient.userId).lean();
          if (user?.email) resolvedEmails.push(user.email);
        } else if (recipient.type === 'custom') {
          if (recipient.email) resolvedEmails.push(recipient.email);
        }
      }

      await this.communicationService.sendEmail({
        restaurantId,
        contactId: contact._id.toString(),
        to: resolvedEmails,
        subject: node.config.subject as string | undefined,
        body: node.config.body as string | undefined,
        context,
        flowId,
        executionId,
      });
      return { success: true, action: 'send_email' };
    } catch (err) {
      return { success: false, action: 'send_email', error: (err as Error).message };
    }
  }

  private async executeSendSMS(
    node: IFlowNode,
    contact: IContactDocument,
    restaurantId: string,
    context: InterpolationContext,
    executionId: string,
    flowId: string,
  ): Promise<ActionResult> {
    const recipient = node.config.recipient as SMSRecipient | undefined;
    let to: string | null = null;

    if (!recipient || recipient.type === 'customer') {
      if (!contact.phone) {
        return { success: true, action: 'send_sms', metadata: { skipped: true, reason: 'no_phone' } };
      }
      to = `${contact.phone.countryCode}${contact.phone.number}`;
    } else if (recipient.type === 'restaurant') {
      const restaurant = await Restaurant.findById(restaurantId).lean();
      to = restaurant?.phone ?? null;
    } else if (recipient.type === 'custom') {
      to = recipient.phone;
    }

    if (!to) {
      return { success: true, action: 'send_sms', metadata: { skipped: true, reason: 'no_phone' } };
    }

    await this.communicationService.sendSMS({
      restaurantId,
      contactId: contact._id.toString(),
      to,
      body: node.config.body as string | undefined,
      context,
      flowId,
      executionId,
    });
    return { success: true, action: 'send_sms' };
  }

  private async executeWebhook(
    node: IFlowNode,
    context: InterpolationContext,
  ): Promise<ActionResult> {
    const { url, body } = node.config as { url?: string; body?: string };

    if (!url) return { success: false, action: 'outgoing_webhook', error: 'No URL in config' };

    let payload: Record<string, unknown>;
    try {
      const interpolated = CommunicationService.interpolate(body ?? '{}', context);
      payload = JSON.parse(interpolated) as Record<string, unknown>;
    } catch (err) {
      log.error({ err, url }, 'Webhook body JSON parse failure');
      return { success: false, action: 'outgoing_webhook', error: 'invalid_json' };
    }

    try {
      await withRetry(
        () => axios.post(url, payload, { timeout: 10_000 }),
        { maxAttempts: 3, operationName: 'outgoing_webhook' },
      );
      return { success: true, action: 'outgoing_webhook', metadata: { url } };
    } catch (err) {
      return { success: false, action: 'outgoing_webhook', error: (err as Error).message };
    }
  }
}
