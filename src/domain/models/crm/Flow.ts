/**
 * @fileoverview CRM Flow Mongoose model with embedded FlowNode and FlowEdge.
 * Collection: `crm_flows`
 *
 * A Flow is a directed acyclic graph (DAG) of automation steps.
 * Nodes define what happens (triggers, actions, conditions, timers, logic).
 * Edges define the connections between nodes (including branch handles).
 *
 * System flows (e.g., "Post-Order Review Request") are auto-created per restaurant
 * and cannot be deleted.
 *
 * @module domain/models/crm/Flow
 */

import mongoose, { Schema, type Document, type Types } from 'mongoose';

// ─── Embedded sub-documents ─────────────────────────────────────────

/** Canvas position for the flow builder UI */
export interface INodePosition {
  x: number;
  y: number;
}

/**
 * A single node in the flow DAG.
 * Embedded in the `crm_flows.nodes` array.
 */
export interface IFlowNode {
  /** Unique ID within the flow (UUID) */
  id: string;
  /** Node category */
  type: string; // NodeType enum value
  /** Specific sub-type (e.g., "order_completed", "send_email", "yes_no") */
  subType: string; // TriggerType | ActionType | LogicType | etc.
  /** Human-readable label */
  label: string;
  /** Canvas position for the React Flow UI */
  position: INodePosition;
  /**
   * Type-specific configuration object. Structure depends on type + subType.
   * @example trigger.order_completed: { orderTypes: ["delivery", "pickup"] }
   * @example action.send_email: { templateId: "...", subject: "..." }
   * @example condition.yes_no: { field: "totalOrders", operator: "gt", value: 5 }
   * @example timer.delay: { duration: 24, unit: "hours" }
   */
  config: Record<string, unknown>;
}

/**
 * An edge connecting two nodes in the flow DAG.
 * Embedded in the `crm_flows.edges` array.
 */
export interface IFlowEdge {
  /** Unique ID (UUID) */
  id: string;
  /** Source node ID (ref → FlowNode.id) */
  sourceNodeId: string;
  /** Target node ID (ref → FlowNode.id) */
  targetNodeId: string;
  /** Output handle from the source node (e.g., "yes", "no", "branch_0", "default") */
  sourceHandle: string | null;
  /** Optional display label on the edge */
  label: string | null;
}

/** Denormalized flow statistics */
export interface IFlowStats {
  /** Total contacts ever enrolled */
  enrollments: number;
  /** Contacts that reached a terminal node */
  completions: number;
  /** Currently active enrollments */
  activeEnrollments: number;
}

// ─── Main Flow document ─────────────────────────────────────────────

/** TypeScript interface for the CRM Flow document */
export interface IFlowDocument extends Document {
  _id: Types.ObjectId;
  restaurantId: Types.ObjectId;
  /** Flow name */
  name: string;
  /** Optional description */
  description: string | null;
  /** Flow lifecycle status */
  status: string; // FlowStatus enum value
  /** System flows (review request) cannot be deleted */
  isSystem: boolean;
  /** Schema version for migration support */
  version: number;
  /** The flow definition: ordered list of nodes */
  nodes: IFlowNode[];
  /** The flow definition: edges connecting nodes */
  edges: IFlowEdge[];
  /** Denormalized execution statistics */
  stats: IFlowStats;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Sub-schemas ────────────────────────────────────────────────────

const FlowNodeSchema = new Schema<IFlowNode>(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },
    subType: { type: String, required: true },
    label: { type: String, required: true },
    position: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
    },
    config: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const FlowEdgeSchema = new Schema<IFlowEdge>(
  {
    id: { type: String, required: true },
    sourceNodeId: { type: String, required: true },
    targetNodeId: { type: String, required: true },
    sourceHandle: { type: String, default: null },
    label: { type: String, default: null },
  },
  { _id: false },
);

const FlowStatsSchema = new Schema<IFlowStats>(
  {
    enrollments: { type: Number, default: 0 },
    completions: { type: Number, default: 0 },
    activeEnrollments: { type: Number, default: 0 },
  },
  { _id: false },
);

// ─── Main schema ────────────────────────────────────────────────────

const FlowSchema = new Schema<IFlowDocument>(
  {
    restaurantId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    status: {
      type: String,
      enum: ['draft', 'active', 'paused', 'archived'],
      default: 'draft',
    },
    isSystem: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
    nodes: { type: [FlowNodeSchema], default: [] },
    edges: { type: [FlowEdgeSchema], default: [] },
    stats: { type: FlowStatsSchema, default: () => ({ enrollments: 0, completions: 0, activeEnrollments: 0 }) },
  },
  {
    collection: 'crm_flows',
    timestamps: true,
  },
);

/** For listing flows by restaurant and status */
FlowSchema.index({ restaurantId: 1, status: 1 });
/** For finding system flows per restaurant */
FlowSchema.index({ restaurantId: 1, isSystem: 1 });

export const Flow = mongoose.model<IFlowDocument>('CrmFlow', FlowSchema);
