/**
 * @fileoverview CRM Flow Execution Log Mongoose model.
 * Collection: `crm_flow_execution_logs`
 *
 * Step-level audit trail for flow executions. Every time a node is processed
 * (trigger fired, action executed, condition evaluated, timer scheduled),
 * a log entry is created.
 *
 * Used for:
 * - Step-level analytics (conversion rates per node)
 * - Debugging flow execution
 * - Contact activity timeline
 *
 * @module domain/models/crm/FlowExecutionLog
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Possible results of processing a node */
export type ExecutionLogResult = 'success' | 'failure' | 'skipped';

/** TypeScript interface for the CRM FlowExecutionLog document */
export interface IFlowExecutionLogDocument extends Document {
  _id: Types.ObjectId;
  /** Reference to the parent execution record */
  executionId: Types.ObjectId;
  /** Flow ID (denormalized for efficient per-flow analytics) */
  flowId: Types.ObjectId;
  /** Tenant isolation (denormalized) */
  restaurantId: Types.ObjectId;
  /** Contact ID (denormalized for contact timeline) */
  contactId: Types.ObjectId;
  /** Which node was processed */
  nodeId: string;
  /** Node type (trigger, action, condition, timer, logic) */
  nodeType: string;
  /** Human-readable description of what happened */
  action: string;
  /** Processing result */
  result: ExecutionLogResult;
  /** Error message if result = "failure" */
  error: string | null;
  /** Additional context (e.g., email provider response, condition evaluation details) */
  metadata: Record<string, unknown>;
  /** When this step was executed */
  executedAt: Date;
}

const FlowExecutionLogSchema = new Schema<IFlowExecutionLogDocument>(
  {
    executionId: { type: Schema.Types.ObjectId, required: true },
    flowId: { type: Schema.Types.ObjectId, required: true },
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    contactId: { type: Schema.Types.ObjectId, required: true },
    nodeId: { type: String, required: true },
    nodeType: { type: String, required: true },
    action: { type: String, required: true },
    result: {
      type: String,
      enum: ['success', 'failure', 'skipped'],
      required: true,
    },
    error: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    executedAt: { type: Date, default: () => new Date() },
  },
  {
    collection: 'crm_flow_execution_logs',
    timestamps: false, // We use executedAt instead
  },
);

/** For listing logs per execution */
FlowExecutionLogSchema.index({ executionId: 1 });
/** For step-level analytics: conversion rate per node in a flow */
FlowExecutionLogSchema.index({ flowId: 1, nodeId: 1 });
/** For contact activity timeline */
FlowExecutionLogSchema.index({ contactId: 1, executedAt: -1 });

export const FlowExecutionLog = mongoose.model<IFlowExecutionLogDocument>(
  'CrmFlowExecutionLog',
  FlowExecutionLogSchema,
);
