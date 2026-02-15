/**
 * @fileoverview Flow engine interface — defines the contract for executing automation flows.
 * The FlowEngineService implements this interface to process the DAG-based flow execution.
 *
 * @module domain/interfaces/IFlowEngine
 */

import type { Types } from 'mongoose';

/**
 * Context passed through a flow execution.
 * Contains runtime data (order info, branch results, loop counters, etc.)
 */
export interface IFlowExecutionContext {
  /** The event that triggered this flow */
  triggerEvent?: Record<string, unknown>;
  /** Order data captured at enrollment time */
  orderData?: Record<string, unknown>;
  /** Contact snapshot at enrollment time */
  contactData?: Record<string, unknown>;
  /** Results of condition evaluations (nodeId → result) */
  branchResults?: Record<string, string>;
  /** Loop iteration counters (nodeId → count) */
  loopCounters?: Record<string, number>;
  /** Allow additional runtime variables */
  [key: string]: unknown;
}

/**
 * Result of processing a single flow node.
 */
export interface INodeProcessingResult {
  /** Whether the node was processed successfully */
  success: boolean;
  /** The source handle to follow for the next edge (e.g., "yes", "no", "branch_0") */
  sourceHandle?: string | null;
  /** Whether the flow should stop after this node (e.g., logic.stop) */
  shouldStop?: boolean;
  /** Whether to wait for a timer (BullMQ job scheduled) */
  shouldWait?: boolean;
  /** Error message if processing failed */
  error?: string;
  /** Additional metadata from the node processing */
  metadata?: Record<string, unknown>;
}

/**
 * Interface for the core flow execution engine.
 * Responsible for enrolling contacts in flows and processing individual nodes.
 */
export interface IFlowEngine {
  /**
   * Enroll a contact into a flow, creating a new FlowExecution record.
   *
   * @param flowId - The flow to enroll in
   * @param contactId - The CRM contact to enroll
   * @param restaurantId - The restaurant scope
   * @param context - Initial execution context (trigger event data, order data, etc.)
   * @returns The created FlowExecution ID
   * @throws If the contact is already enrolled in this flow, or the flow is not active
   */
  enrollContact(
    flowId: Types.ObjectId,
    contactId: Types.ObjectId,
    restaurantId: Types.ObjectId,
    context: IFlowExecutionContext,
  ): Promise<Types.ObjectId>;

  /**
   * Process the current node of a flow execution.
   * Dispatches to the appropriate handler based on node type.
   *
   * @param executionId - The FlowExecution to process
   * @returns Result indicating what to do next (advance, wait, stop)
   */
  processNode(executionId: Types.ObjectId): Promise<INodeProcessingResult>;

  /**
   * Advance a flow execution to the next node via the appropriate edge.
   *
   * @param executionId - The FlowExecution to advance
   * @param sourceHandle - The edge handle to follow (e.g., "yes", "no", null for default)
   */
  advanceToNext(executionId: Types.ObjectId, sourceHandle?: string | null): Promise<void>;
}
