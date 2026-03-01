/**
 * @fileoverview CRM Flow Execution Mongoose model.
 * Collection: `crm_flow_executions`
 *
 * Tracks the enrollment and progress of a single contact through a flow.
 * Each record represents one contact in one flow — the "execution" moves
 * through nodes as the contact advances through the DAG.
 *
 * Timer steps pause execution by setting `nextExecutionAt`. A BullMQ job
 * resumes processing when the timer fires.
 *
 * @module domain/models/crm/FlowExecution
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

/** Possible execution states */
export type FlowExecutionStatus = 'active' | 'completed' | 'stopped' | 'error';

/** TypeScript interface for the CRM FlowExecution document */
export interface IFlowExecutionDocument extends Document {
  _id: Types.ObjectId;
  /** Reference to the flow being executed */
  flowId: Types.ObjectId;
  /** Tenant isolation */
  restaurantId: Types.ObjectId;
  /** The contact traversing the flow */
  contactId: Types.ObjectId;
  /** Current execution state */
  status: FlowExecutionStatus;
  /** Which node the contact is currently at (null if completed/stopped) */
  currentNodeId: string | null;
  /** When the execution started (enrollment time) */
  startedAt: Date;
  /** When the execution finished (completed, stopped, or errored) */
  completedAt: Date | null;
  /** For timer steps: when to resume processing */
  nextExecutionAt: Date | null;
  /**
   * Runtime context variables available to node processing.
   * Populated by triggers (order data), conditions (branch results), etc.
   * @example { orderId: "...", orderTotal: 45.99, branchResults: { node_3: "yes" } }
   */
  context: Record<string, unknown>;
  /** Error metadata set when execution enters error state */
  errorMetadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const FlowExecutionSchema = new Schema<IFlowExecutionDocument>(
  {
    flowId: { type: Schema.Types.ObjectId, required: true },
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    contactId: { type: Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      enum: ['active', 'completed', 'stopped', 'error'],
      default: 'active',
    },
    currentNodeId: { type: String, default: null },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date, default: null },
    nextExecutionAt: { type: Date, default: null },
    context: { type: Schema.Types.Mixed, default: {} },
    errorMetadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    collection: 'crm_flow_executions',
    timestamps: true,
  },
);

/** For listing enrollments per flow */
FlowExecutionSchema.index({ flowId: 1, status: 1 });
/** For checking if a contact is already in a flow / listing contact's flows */
FlowExecutionSchema.index({ contactId: 1, flowId: 1 });
/** For timer processing: find executions ready to resume */
FlowExecutionSchema.index({ nextExecutionAt: 1 });
/** For restaurant-scoped queries */
FlowExecutionSchema.index({ restaurantId: 1, status: 1 });

export const FlowExecution = mongoose.model<IFlowExecutionDocument>(
  'CrmFlowExecution',
  FlowExecutionSchema,
);
