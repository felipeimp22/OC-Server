/**
 * @fileoverview Analytics routes — /api/v1/analytics
 *
 * @module api/routes/analytics
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AnalyticsService } from '../../services/AnalyticsService.js';
import { CampaignService } from '../../services/CampaignService.js';
import { idParam, paginationQuery } from '../validators/index.js';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  const analyticsService = new AnalyticsService();
  const campaignService = new CampaignService();

  // GET /api/v1/analytics/overview
  app.get('/overview', async (request: FastifyRequest) => {
    return analyticsService.getDashboardOverview(request.restaurantId);
  });

  // GET /api/v1/analytics/flows/:id
  app.get('/flows/:id', async (request: FastifyRequest) => {
    const { id } = idParam.parse(request.params);
    return analyticsService.getFlowAnalytics(id);
  });

  // GET /api/v1/analytics/messaging
  app.get('/messaging', async (request: FastifyRequest) => {
    const { since } = request.query as Record<string, string>;
    const sinceDate = since ? new Date(since) : undefined;
    return analyticsService.getMessagingStats(request.restaurantId, sinceDate);
  });

  // GET /api/v1/analytics/campaigns
  app.get('/campaigns', async (request: FastifyRequest) => {
    const query = paginationQuery.parse(request.query);
    return campaignService.list(request.restaurantId, {}, {
      page: query.page,
      limit: query.limit,
    });
  });
}
