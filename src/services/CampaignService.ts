/**
 * @fileoverview Campaign Service — campaign tracking and revenue attribution.
 *
 * @module services/CampaignService
 */

import { CampaignRepository } from '../repositories/CampaignRepository.js';
import type { ICampaignDocument } from '../domain/models/crm/Campaign.js';
import type { IPaginationOptions, IPaginatedResult } from '../domain/interfaces/IRepository.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('CampaignService');

export class CampaignService {
  private readonly campaignRepo: CampaignRepository;

  constructor() {
    this.campaignRepo = new CampaignRepository();
  }

  async create(restaurantId: string, data: {
    name: string;
    description?: string;
    flowIds?: string[];
    source?: string;
  }): Promise<ICampaignDocument> {
    return this.campaignRepo.create({
      restaurantId,
      name: data.name,
      description: data.description ?? null,
      flowIds: data.flowIds ?? [],
      source: data.source ?? null,
    } as any);
  }

  async getById(restaurantId: string, id: string): Promise<ICampaignDocument | null> {
    return this.campaignRepo.findById(restaurantId, id);
  }

  async list(
    restaurantId: string,
    filters: Record<string, unknown> = {},
    pagination?: IPaginationOptions,
  ): Promise<IPaginatedResult<ICampaignDocument>> {
    return this.campaignRepo.findPaginated(restaurantId, filters, pagination);
  }

  async update(restaurantId: string, id: string, data: Partial<ICampaignDocument>): Promise<ICampaignDocument | null> {
    return this.campaignRepo.updateById(restaurantId, id, { $set: data });
  }

  async attributeRevenue(campaignId: string, orderTotal: number): Promise<void> {
    await this.campaignRepo.incrementStats(campaignId, {
      revenueAttributed: orderTotal,
      ordersAttributed: 1,
    });
    log.info({ campaignId, orderTotal }, 'Revenue attributed to campaign');
  }
}
