/**
 * @fileoverview Meta CAPI provider factory (singleton pattern).
 *
 * @module factories/MetaProviderFactory
 */

import { env } from '../config/env.js';
import { MetaCAPIProvider } from '../providers/meta/MetaCAPIProvider.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('MetaProviderFactory');

let instance: MetaCAPIProvider | null = null;

/**
 * Get the singleton Meta CAPI provider instance.
 * Returns null if Meta credentials are not configured.
 */
export function getMetaProvider(): MetaCAPIProvider | null {
  if (instance) return instance;

  if (!env.META_PIXEL_ID || !env.META_ACCESS_TOKEN) {
    log.info('Meta CAPI not configured (META_PIXEL_ID or META_ACCESS_TOKEN missing)');
    return null;
  }

  instance = new MetaCAPIProvider(env.META_PIXEL_ID, env.META_ACCESS_TOKEN);
  log.info('Meta CAPI provider initialized');
  return instance;
}
