/**
 * @fileoverview Webhook Service — outgoing webhooks to external URLs.
 *
 * @module services/WebhookService
 */

import axios from 'axios';
import { withRetry } from '../utils/retryHelper.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('WebhookService');

export class WebhookService {
  /**
   * Send a webhook POST request to an external URL.
   */
  async send(
    url: string,
    payload: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    try {
      const response = await withRetry(
        () => axios.post(url, payload, { headers, timeout: 10_000 }),
        { maxAttempts: 3, operationName: 'outgoing_webhook' },
      );
      log.info({ url, statusCode: response.status }, 'Webhook sent');
      return { success: true, statusCode: response.status };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error({ err, url }, 'Webhook failed');
      return { success: false, error: errorMsg };
    }
  }
}
