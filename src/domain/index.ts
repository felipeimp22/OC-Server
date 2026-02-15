/**
 * @fileoverview Root barrel export for the entire domain layer.
 *
 * Re-exports all enums, interfaces, and models for convenient imports:
 * ```ts
 * import { LifecycleStatus } from '@/domain/enums/index.js';
 * import { Contact } from '@/domain/models/crm/index.js';
 * import { Restaurant } from '@/domain/models/external/index.js';
 * ```
 *
 * @module domain
 */

export * from './enums/index.js';
export * from './interfaces/index.js';
export * as models from './models/index.js';
