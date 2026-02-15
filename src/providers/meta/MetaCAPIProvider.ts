/**
 * @fileoverview Meta Conversions API (CAPI) provider.
 *
 * Sends server-side events to Meta (Facebook) for conversion tracking.
 * Used by the `meta_capi` action node in flows.
 *
 * @module providers/meta/MetaCAPIProvider
 */

import axios from 'axios';
import { createHash } from 'node:crypto';
import { createLogger } from '../../config/logger.js';

const log = createLogger('MetaCAPIProvider');

/** Meta CAPI event data */
export interface MetaCAPIEvent {
  /** Event name (e.g., "Purchase", "Lead", "Contact") */
  eventName: string;
  /** Event timestamp (Unix epoch seconds) */
  eventTime: number;
  /** User data for matching */
  userData: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    externalId?: string;
  };
  /** Custom data (order value, currency, etc.) */
  customData?: {
    value?: number;
    currency?: string;
    orderId?: string;
    [key: string]: unknown;
  };
  /** Event source URL */
  eventSourceUrl?: string;
  /** Action source */
  actionSource?: 'website' | 'email' | 'phone_call' | 'chat' | 'system_generated' | 'other';
}

export class MetaCAPIProvider {
  private readonly pixelId: string;
  private readonly accessToken: string;
  private readonly apiVersion = 'v18.0';

  constructor(pixelId: string, accessToken: string) {
    this.pixelId = pixelId;
    this.accessToken = accessToken;
  }

  /**
   * Send a server-side event to Meta Conversions API.
   *
   * @param event - Event data
   * @returns Success status
   */
  async sendEvent(event: MetaCAPIEvent): Promise<{ success: boolean; error?: string }> {
    try {
      const payload = {
        data: [
          {
            event_name: event.eventName,
            event_time: event.eventTime,
            action_source: event.actionSource ?? 'system_generated',
            event_source_url: event.eventSourceUrl,
            user_data: {
              em: event.userData.email ? this.hash(event.userData.email.toLowerCase()) : undefined,
              ph: event.userData.phone ? this.hash(event.userData.phone) : undefined,
              fn: event.userData.firstName ? this.hash(event.userData.firstName.toLowerCase()) : undefined,
              ln: event.userData.lastName ? this.hash(event.userData.lastName.toLowerCase()) : undefined,
              external_id: event.userData.externalId ? this.hash(event.userData.externalId) : undefined,
            },
            custom_data: event.customData
              ? {
                  value: event.customData.value,
                  currency: event.customData.currency ?? 'USD',
                  order_id: event.customData.orderId,
                }
              : undefined,
          },
        ],
      };

      const url = `https://graph.facebook.com/${this.apiVersion}/${this.pixelId}/events?access_token=${this.accessToken}`;
      await axios.post(url, payload, { timeout: 10_000 });

      log.info({ eventName: event.eventName }, 'Meta CAPI event sent');
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err, eventName: event.eventName }, 'Meta CAPI send failed');
      return { success: false, error: errorMessage };
    }
  }

  /** SHA-256 hash for PII data (Meta requirement) */
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
