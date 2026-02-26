/**
 * @fileoverview Analytics Service — dashboard metrics and reporting.
 *
 * @module services/AnalyticsService
 */

import { ContactRepository } from '../repositories/ContactRepository.js';
import { FlowExecutionLogRepository } from '../repositories/FlowExecutionLogRepository.js';
import { CommunicationLogRepository } from '../repositories/CommunicationLogRepository.js';
import { FlowExecutionRepository } from '../repositories/FlowExecutionRepository.js';
import { FlowRepository } from '../repositories/FlowRepository.js';

export interface DashboardOverview {
  totalContacts: number;
  newContactsThisMonth: number;
  segments: Record<string, number>;
  activeFlows: number;
  totalEnrollments: number;
  messagingStats: { channel: string; status: string; count: number }[];
}

export class AnalyticsService {
  private readonly contactRepo: ContactRepository;
  private readonly logRepo: FlowExecutionLogRepository;
  private readonly commLogRepo: CommunicationLogRepository;
  private readonly executionRepo: FlowExecutionRepository;
  private readonly flowRepo: FlowRepository;

  constructor() {
    this.contactRepo = new ContactRepository();
    this.logRepo = new FlowExecutionLogRepository();
    this.commLogRepo = new CommunicationLogRepository();
    this.executionRepo = new FlowExecutionRepository();
    this.flowRepo = new FlowRepository();
  }

  /**
   * Get dashboard overview for a restaurant.
   */
  async getOverview(restaurantId: string): Promise<DashboardOverview> {
    const [totalContacts, newContactsThisMonth, segments, messagingStats, totalEnrollments, activeFlows] = await Promise.all([
      this.contactRepo.count(restaurantId),
      this.contactRepo.countNewThisMonth(restaurantId),
      this.contactRepo.getSegmentCounts(restaurantId),
      this.commLogRepo.getMessagingStats(restaurantId),
      this.executionRepo.count(restaurantId),
      this.flowRepo.countActive(restaurantId),
    ]);

    return {
      totalContacts,
      newContactsThisMonth,
      segments,
      activeFlows,
      totalEnrollments,
      messagingStats,
    };
  }

  /**
   * Get per-flow node analytics.
   */
  async getFlowAnalytics(flowId: string) {
    return this.logRepo.getNodeStats(flowId);
  }

  /**
   * Get messaging stats with optional time filter.
   */
  async getMessagingStats(restaurantId: string, since?: Date) {
    return this.commLogRepo.getMessagingStats(restaurantId, since);
  }
}
