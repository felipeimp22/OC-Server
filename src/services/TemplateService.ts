/**
 * @fileoverview Template Service — CRUD for email/SMS templates.
 *
 * @module services/TemplateService
 */

import { TemplateRepository } from '../repositories/TemplateRepository.js';
import type { ICommunicationTemplateDocument } from '../domain/models/crm/CommunicationTemplate.js';
import type { IPaginationOptions, IPaginatedResult } from '../domain/interfaces/IRepository.js';
import { interpolate, extractVariables, type InterpolationContext } from '../utils/variableInterpolator.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('TemplateService');

export class TemplateService {
  private readonly templateRepo: TemplateRepository;

  constructor() {
    this.templateRepo = new TemplateRepository();
  }

  async create(
    restaurantId: string,
    data: {
      channel: string;
      name: string;
      subject?: string;
      body: string;
      isSystem?: boolean;
    },
  ): Promise<ICommunicationTemplateDocument> {
    const variables = extractVariables(data.body);
    if (data.subject) {
      variables.push(...extractVariables(data.subject));
    }
    const uniqueVars = [...new Set(variables)];

    const template = await this.templateRepo.create({
      restaurantId,
      channel: data.channel,
      name: data.name,
      subject: data.subject ?? null,
      body: data.body,
      isSystem: data.isSystem ?? false,
      variables: uniqueVars,
    } as any);

    log.info({ restaurantId, templateId: template._id, name: template.name }, 'Template created');
    return template;
  }

  async getById(restaurantId: string, templateId: string): Promise<ICommunicationTemplateDocument | null> {
    return this.templateRepo.findById(restaurantId, templateId);
  }

  async list(
    restaurantId: string,
    filters: Record<string, unknown> = {},
    pagination?: IPaginationOptions,
  ): Promise<IPaginatedResult<ICommunicationTemplateDocument>> {
    return this.templateRepo.findPaginated(restaurantId, filters, pagination);
  }

  async update(
    restaurantId: string,
    templateId: string,
    data: Partial<Pick<ICommunicationTemplateDocument, 'name' | 'subject' | 'body'>>,
  ): Promise<ICommunicationTemplateDocument | null> {
    // Recalculate variables if body changed
    if (data.body) {
      const variables = extractVariables(data.body);
      if (data.subject) {
        variables.push(...extractVariables(data.subject));
      }
      (data as Record<string, unknown>).variables = [...new Set(variables)];
    }

    return this.templateRepo.updateById(restaurantId, templateId, { $set: data });
  }

  async delete(restaurantId: string, templateId: string): Promise<boolean> {
    const template = await this.templateRepo.findById(restaurantId, templateId);
    if (!template) return false;
    if (template.isSystem) throw new Error('System templates cannot be deleted');

    return this.templateRepo.deleteById(restaurantId, templateId);
  }

  /**
   * Preview a template with sample data.
   */
  async preview(
    restaurantId: string,
    templateId: string,
    sampleData: InterpolationContext,
  ): Promise<{ subject: string | null; body: string }> {
    const template = await this.templateRepo.findById(restaurantId, templateId);
    if (!template) throw new Error('Template not found');

    return {
      subject: template.subject ? interpolate(template.subject, sampleData) : null,
      body: interpolate(template.body, sampleData),
    };
  }
}
