/**
 * @fileoverview Root barrel export for all domain models.
 *
 * Organized into two namespaces:
 * - `external` — Read-only Mongoose schemas for existing OrderChop collections
 * - `crm` — CRM-owned collections (crm_* prefix)
 *
 * @module domain/models
 */

export * as external from './external/index.js';
export * as crm from './crm/index.js';
