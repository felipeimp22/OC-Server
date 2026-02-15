/**
 * @fileoverview CRM Communication Template repository.
 *
 * @module repositories/TemplateRepository
 */

import type { Types, FilterQuery } from 'mongoose';
import { BaseRepository } from './base/BaseRepository.js';
import { CommunicationTemplate, type ICommunicationTemplateDocument } from '../domain/models/crm/CommunicationTemplate.js';

export class TemplateRepository extends BaseRepository<ICommunicationTemplateDocument> {
  constructor() {
    super(CommunicationTemplate, 'TemplateRepository');
  }

  /**
   * Find templates by channel (email or sms).
   */
  async findByChannel(
    restaurantId: Types.ObjectId | string,
    channel: string,
  ): Promise<ICommunicationTemplateDocument[]> {
    return this.find(restaurantId, { channel } as FilterQuery<ICommunicationTemplateDocument>);
  }

  /**
   * Find system templates for a restaurant.
   */
  async findSystemTemplates(
    restaurantId: Types.ObjectId | string,
  ): Promise<ICommunicationTemplateDocument[]> {
    return this.find(restaurantId, { isSystem: true } as FilterQuery<ICommunicationTemplateDocument>);
  }
}
