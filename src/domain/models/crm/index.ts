/**
 * @fileoverview Barrel export for all CRM-owned Mongoose models.
 * These models map to `crm_*` collections owned by the CRM engine.
 *
 * @module domain/models/crm
 */

// Contact
export { Contact, type IContactDocument, type IContactPhone } from './Contact.js';

// Tags & Custom Fields
export { Tag, type ITagDocument } from './Tag.js';
export { CustomField, type ICustomFieldDocument, type CustomFieldType } from './CustomField.js';

// Flow engine
export {
  Flow,
  type IFlowDocument,
  type IFlowNode,
  type IFlowEdge,
  type INodePosition,
  type IFlowStats,
} from './Flow.js';
export {
  FlowExecution,
  type IFlowExecutionDocument,
  type FlowExecutionStatus,
} from './FlowExecution.js';
export {
  FlowExecutionLog,
  type IFlowExecutionLogDocument,
  type ExecutionLogResult,
} from './FlowExecutionLog.js';

// Communication
export {
  CommunicationTemplate,
  type ICommunicationTemplateDocument,
} from './CommunicationTemplate.js';
export {
  CommunicationLog,
  type ICommunicationLogDocument,
  type CommunicationStatus,
} from './CommunicationLog.js';
export { LinkTracking, type ILinkTrackingDocument } from './LinkTracking.js';

// Review requests
export {
  ReviewRequest,
  type IReviewRequestDocument,
  type ReviewRequestStatus,
} from './ReviewRequest.js';

// Campaigns
export { Campaign, type ICampaignDocument, type CampaignStatus } from './Campaign.js';

// Tasks (from CRM.docx)
export { Task, type ITaskDocument, type TaskPriority, type TaskStatus } from './Task.js';

// Idempotency
export { ProcessedEvent, type IProcessedEventDocument } from './ProcessedEvent.js';
