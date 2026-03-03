/**
 * @fileoverview Root barrel export for all domain models.
 *
 * Organized into three namespaces:
 * - `external` — Read-only Mongoose schemas for existing OrderChop collections
 * - `crm` — CRM-owned collections (crm_* prefix)
 * - Top-level exports — Infrastructure models (QueueMessage, Printer, PrintJob, PrinterSettings)
 *
 * @module domain/models
 */

export * as external from './external/index.js';
export * as crm from './crm/index.js';

// Queue infrastructure
export { QueueMessage, type IQueueMessageDocument, type QueueMessageStatus } from './QueueMessage.js';

// Printer system
export { Printer, type IPrinterDocument, type PrinterType } from './Printer.js';
export { PrintJob, type IPrintJobDocument, type PrintJobStatus, type PrintTrigger } from './PrintJob.js';
export { PrinterSettings, type IPrinterSettingsDocument } from './PrinterSettings.js';
