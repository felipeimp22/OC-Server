/**
 * @fileoverview Node type enum for flow builder nodes.
 * Each node in a flow DAG belongs to one of these categories.
 *
 * @module domain/enums/NodeType
 */

/** Top-level categories for flow builder nodes */
export const NodeType = {
  /** Entry point — what triggers the flow */
  TRIGGER: 'trigger',
  /** Performs an action (send email, apply tag, etc.) */
  ACTION: 'action',
  /** Evaluates a condition and branches (yes/no, A/B, multi) */
  CONDITION: 'condition',
  /** Introduces a time delay before the next step */
  TIMER: 'timer',
  /** Control flow logic (stop, loop, skip, until) */
  LOGIC: 'logic',
} as const;

/** Union type of all node type values */
export type NodeType = (typeof NodeType)[keyof typeof NodeType];

/** Array of all node types for iteration / validation */
export const NODE_TYPES: readonly NodeType[] = Object.values(NodeType);
