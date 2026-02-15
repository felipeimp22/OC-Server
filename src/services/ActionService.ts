/**
 * @fileoverview Action Service — executes action nodes in flows.
 *
 * Handles all action types:
 * - send_email, send_sms
 * - apply_tag, remove_tag
 * - update_field
 * - add_note
 * - create_task, assign_owner
 * - outgoing_webhook
 * - meta_capi
 * - admin_notification
 *
 * @module services/ActionService
 */

import axios from 'axios';
import type { IFlowNode } from '../domain/models/crm/Flow.js';
import type { IContactDocument } from '../domain/models/crm/Contact.js';
import { CommunicationService } from './CommunicationService.js';
import { ContactService } from './ContactService.js';
import { TaskRepository } from '../repositories/TaskRepository.js';
import { getMetaProvider } from '../factories/MetaProviderFactory.js';
import { buildContext, type InterpolationContext } from '../utils/variableInterpolator.js';
import { withRetry } from '../utils/retryHelper.js';

/** Result of executing an action */
export interface ActionResult {
  success: boolean;
  action: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export class ActionService {
  private readonly communicationService: CommunicationService;
  private readonly contactService: ContactService;
  private readonly taskRepo: TaskRepository;

  constructor() {
    this.communicationService = new CommunicationService();
    this.contactService = new ContactService();
    this.taskRepo = new TaskRepository();
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
   * @returns Action result
   */
  async execute(
    node: IFlowNode,
    contact: IContactDocument,
    restaurantId: string,
    executionContext: Record<string, unknown>,
    executionId: string,
    flowId: string,
  ): Promise<ActionResult> {
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
        return this.executeSendEmail(node, contact, restaurantId, context, executionId, flowId);
      case 'send_sms':
        return this.executeSendSMS(node, contact, restaurantId, context, executionId, flowId);
      case 'apply_tag':
        return this.executeApplyTag(node, contact, restaurantId);
      case 'remove_tag':
        return this.executeRemoveTag(node, contact, restaurantId);
      case 'update_field':
        return this.executeUpdateField(node, contact, restaurantId);
      case 'add_note':
        return this.executeAddNote(node, contact, restaurantId);
      case 'create_task':
        return this.executeCreateTask(node, contact, restaurantId, executionId);
      case 'assign_owner':
        return this.executeAssignOwner(node, contact, restaurantId);
      case 'outgoing_webhook':
        return this.executeWebhook(node, contact, restaurantId, executionContext);
      case 'meta_capi':
        return this.executeMetaCAPI(node, contact, executionContext);
      case 'admin_notification':
        return this.executeAdminNotification(node, restaurantId, context, executionId, flowId);
      default:
        return { success: false, action: node.subType, error: `Unknown action type: ${node.subType}` };
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
      await this.communicationService.sendEmail({
        restaurantId,
        contactId: contact._id.toString(),
        to: contact.email,
        templateId: node.config.templateId as string | undefined,
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
    if (!contact.phone) {
      return { success: false, action: 'send_sms', error: 'Contact has no phone number' };
    }
    try {
      const phoneNum = `${contact.phone.countryCode}${contact.phone.number}`;
      await this.communicationService.sendSMS({
        restaurantId,
        contactId: contact._id.toString(),
        to: phoneNum,
        templateId: node.config.templateId as string | undefined,
        body: node.config.body as string | undefined,
        context,
        flowId,
        executionId,
      });
      return { success: true, action: 'send_sms' };
    } catch (err) {
      return { success: false, action: 'send_sms', error: (err as Error).message };
    }
  }

  private async executeApplyTag(
    node: IFlowNode,
    contact: IContactDocument,
    restaurantId: string,
  ): Promise<ActionResult> {
    const tagId = node.config.tagId as string;
    if (!tagId) return { success: false, action: 'apply_tag', error: 'No tagId in config' };

    await this.contactService.applyTag(restaurantId, contact._id.toString(), tagId);
    return { success: true, action: 'apply_tag', metadata: { tagId } };
  }

  private async executeRemoveTag(
    node: IFlowNode,
    contact: IContactDocument,
    restaurantId: string,
  ): Promise<ActionResult> {
    const tagId = node.config.tagId as string;
    if (!tagId) return { success: false, action: 'remove_tag', error: 'No tagId in config' };

    await this.contactService.removeTag(restaurantId, contact._id.toString(), tagId);
    return { success: true, action: 'remove_tag', metadata: { tagId } };
  }

  private async executeUpdateField(
    node: IFlowNode,
    contact: IContactDocument,
    restaurantId: string,
  ): Promise<ActionResult> {
    const { fieldKey, value } = node.config as { fieldKey: string; value: unknown };
    if (!fieldKey) return { success: false, action: 'update_field', error: 'No fieldKey in config' };

    await this.contactService.update(restaurantId, contact._id.toString(), {
      [`customFields.${fieldKey}`]: value,
    } as Partial<IContactDocument>);

    return { success: true, action: 'update_field', metadata: { fieldKey, value } };
  }

  private async executeAddNote(
    _node: IFlowNode,
    _contact: IContactDocument,
    _restaurantId: string,
  ): Promise<ActionResult> {
    // Notes can be stored as flow execution log metadata
    return { success: true, action: 'add_note' };
  }

  private async executeCreateTask(
    node: IFlowNode,
    contact: IContactDocument,
    restaurantId: string,
    executionId: string,
  ): Promise<ActionResult> {
    const { title, description, priority, assignedTo, dueInDays } = node.config as {
      title?: string;
      description?: string;
      priority?: string;
      assignedTo?: string;
      dueInDays?: number;
    };

    const dueAt = dueInDays ? new Date(Date.now() + dueInDays * 86400000) : null;

    const task = await this.taskRepo.create({
      restaurantId,
      title: title ?? 'Follow up',
      description: description ?? null,
      priority: priority ?? 'medium',
      status: 'pending',
      contactId: contact._id,
      assignedTo: assignedTo ?? null,
      flowExecutionId: executionId,
      dueAt,
    } as any);

    return { success: true, action: 'create_task', metadata: { taskId: task._id.toString() } };
  }

  private async executeAssignOwner(
    node: IFlowNode,
    contact: IContactDocument,
    restaurantId: string,
  ): Promise<ActionResult> {
    const { ownerId } = node.config as { ownerId?: string };
    if (!ownerId) return { success: false, action: 'assign_owner', error: 'No ownerId in config' };

    await this.contactService.update(restaurantId, contact._id.toString(), {
      [`customFields._owner`]: ownerId,
    } as Partial<IContactDocument>);

    return { success: true, action: 'assign_owner', metadata: { ownerId } };
  }

  private async executeWebhook(
    node: IFlowNode,
    contact: IContactDocument,
    restaurantId: string,
    executionContext: Record<string, unknown>,
  ): Promise<ActionResult> {
    const { url, method, headers, body } = node.config as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: Record<string, unknown>;
    };

    if (!url) return { success: false, action: 'outgoing_webhook', error: 'No URL in config' };

    try {
      const payload = {
        restaurantId,
        contactId: contact._id.toString(),
        contact: {
          email: contact.email,
          firstName: contact.firstName,
          lastName: contact.lastName,
          phone: contact.phone,
          lifecycleStatus: contact.lifecycleStatus,
        },
        context: executionContext,
        ...(body ?? {}),
      };

      await withRetry(
        () =>
          axios({
            method: (method as string) ?? 'POST',
            url,
            headers: headers ?? {},
            data: payload,
            timeout: 10_000,
          }),
        { maxAttempts: 3, operationName: 'outgoing_webhook' },
      );

      return { success: true, action: 'outgoing_webhook', metadata: { url } };
    } catch (err) {
      return { success: false, action: 'outgoing_webhook', error: (err as Error).message };
    }
  }

  private async executeMetaCAPI(
    node: IFlowNode,
    contact: IContactDocument,
    executionContext: Record<string, unknown>,
  ): Promise<ActionResult> {
    const metaProvider = getMetaProvider();
    if (!metaProvider) {
      return { success: false, action: 'meta_capi', error: 'Meta CAPI not configured' };
    }

    const { eventName } = node.config as { eventName?: string };

    const result = await metaProvider.sendEvent({
      eventName: eventName ?? 'Lead',
      eventTime: Math.floor(Date.now() / 1000),
      userData: {
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        externalId: contact._id.toString(),
      },
      customData: {
        value: (executionContext.orderTotal as number) ?? undefined,
        currency: (executionContext.currency as string) ?? 'USD',
        orderId: (executionContext.orderId as string) ?? undefined,
      },
    });

    return { success: result.success, action: 'meta_capi', error: result.error };
  }

  private async executeAdminNotification(
    node: IFlowNode,
    restaurantId: string,
    context: InterpolationContext,
    executionId: string,
    flowId: string,
  ): Promise<ActionResult> {
    const { to, subject, body, channel } = node.config as {
      to?: string;
      subject?: string;
      body?: string;
      channel?: string;
    };

    if (!to) return { success: false, action: 'admin_notification', error: 'No recipient' };

    try {
      if (channel === 'sms') {
        await this.communicationService.sendSMS({
          restaurantId,
          contactId: 'system',
          to,
          body,
          context,
          flowId,
          executionId,
        });
      } else {
        await this.communicationService.sendEmail({
          restaurantId,
          contactId: 'system',
          to,
          subject,
          body,
          context,
          flowId,
          executionId,
        });
      }
      return { success: true, action: 'admin_notification' };
    } catch (err) {
      return { success: false, action: 'admin_notification', error: (err as Error).message };
    }
  }
}
