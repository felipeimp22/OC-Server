/**
 * @fileoverview Barrel export for all domain interfaces.
 *
 * @module domain/interfaces
 */

export type { ICRMEvent, ICRMEventPayload } from './IEvent.js';
export type {
  IFlowEngine,
  IFlowExecutionContext,
  INodeProcessingResult,
} from './IFlowEngine.js';
export type {
  IEmailProvider,
  IEmailOptions,
  IEmailSendResult,
  ISMSProvider,
  ISMSOptions,
  ISMSSendResult,
} from './ICommunicationProvider.js';
export type {
  IRepository,
  IPaginationOptions,
  IPaginatedResult,
} from './IRepository.js';
