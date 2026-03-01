/**
 * @fileoverview Flow Engine Service — the heart of the CRM automation system.
 *
 * Executes flow nodes in sequence following the DAG structure:
 * 1. Load execution, flow, and contact
 * 2. Get current node
 * 3. Process node based on type (trigger → action → condition → timer → logic)
 * 4. Log the result
 * 5. Advance to next node (following edges)
 * 6. If next node exists → produce `flow.step.ready` to Kafka
 * 7. If no next node → mark execution complete
 *
 * Timer nodes pause execution. When the timer fires (via BullMQ),
 * processing resumes from where it left off.
 *
 * @module services/FlowEngineService
 */

import { FlowRepository } from '../repositories/FlowRepository.js';
import { FlowExecutionRepository } from '../repositories/FlowExecutionRepository.js';
import { FlowExecutionLogRepository } from '../repositories/FlowExecutionLogRepository.js';
import { ContactRepository } from '../repositories/ContactRepository.js';
import { ConditionService, type ConditionResult } from './ConditionService.js';
import { ActionService, type ActionResult } from './ActionService.js';
import { TimerService } from './TimerService.js';
import { StoreHours } from '../domain/models/external/StoreHours.js';
import { Restaurant } from '../domain/models/external/Restaurant.js';
import type { IFlowDocument, IFlowNode, IFlowEdge } from '../domain/models/crm/Flow.js';
import type { IFlowExecutionDocument } from '../domain/models/crm/FlowExecution.js';
import type { IFlowExecutionLogDocument } from '../domain/models/crm/FlowExecutionLog.js';
import type { IContactDocument } from '../domain/models/crm/Contact.js';
import { produceFlowStepReady } from '../kafka/producers/FlowEventProducer.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('FlowEngineService');

export class FlowEngineService {
  private readonly flowRepo: FlowRepository;
  private readonly executionRepo: FlowExecutionRepository;
  private readonly logRepo: FlowExecutionLogRepository;
  private readonly contactRepo: ContactRepository;
  private readonly conditionService: ConditionService;
  private readonly actionService: ActionService;
  private readonly timerService: TimerService;

  constructor() {
    this.flowRepo = new FlowRepository();
    this.executionRepo = new FlowExecutionRepository();
    this.logRepo = new FlowExecutionLogRepository();
    this.contactRepo = new ContactRepository();
    this.conditionService = new ConditionService();
    this.actionService = new ActionService();
    this.timerService = new TimerService();
  }

  /**
   * Enroll a contact in a flow.
   * Creates a FlowExecution starting at the trigger node, then kicks off
   * DAG processing via processCurrentNode().
   *
   * @param restaurantId - Tenant ID
   * @param flowId - Flow to enroll in
   * @param contactId - Contact to enroll
   * @param context - Initial execution context (e.g. order data)
   */
  async enrollContact(
    restaurantId: string,
    flowId: string,
    contactId: string,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    log.info({ restaurantId, flowId, contactId }, 'Enrolling contact in flow');

    // Load flow to find trigger node
    const flow = await this.flowRepo.findById(restaurantId, flowId);
    if (!flow) {
      log.warn({ restaurantId, flowId }, 'enrollContact: Flow not found');
      return;
    }

    // Find trigger node (currentNodeId starts here)
    const triggerNode = flow.nodes.find((n) => n.type === 'trigger');
    if (!triggerNode) {
      log.warn({ flowId }, 'enrollContact: No trigger node in flow');
      return;
    }

    // Anti-spam: skip if already actively enrolled
    const alreadyEnrolled = await this.executionRepo.isContactEnrolled(restaurantId, flowId, contactId);
    if (alreadyEnrolled) {
      log.debug({ flowId, contactId }, 'Contact already enrolled — skipping');
      return;
    }

    // Create execution record (pendingNodes starts with trigger for fan-out tracking)
    const execution = await this.executionRepo.create({
      flowId,
      restaurantId,
      contactId,
      status: 'active',
      currentNodeId: triggerNode.id,
      pendingNodes: [triggerNode.id],
      context,
    } as any);

    // Increment enrollment stats
    await this.flowRepo.incrementEnrollments(flowId);

    log.info({ restaurantId, flowId, contactId, executionId: execution._id }, 'Contact enrolled in flow');

    // Begin DAG traversal
    await this.processCurrentNode(execution._id.toString());
  }

  /**
   * Process a specific node for a flow execution.
   * This is the main entry point called by Kafka consumers when
   * a `flow.step.ready` event is received.
   *
   * For fan-out: multiple concurrent calls may process different nodes
   * of the same execution in parallel. Each call uses the nodeId from
   * the Kafka event (not execution.currentNodeId) to determine which
   * node to process.
   *
   * @param executionId - The flow execution ID
   * @param nodeId - The specific node to process (from Kafka event). Falls back to execution.currentNodeId for backward compat.
   */
  async processCurrentNode(executionId: string, nodeId?: string): Promise<void> {
    // 1. Load execution (tenant-free lookup — executionId is the primary key here)
    const execution = await this.executionRepo.findByExecutionId(executionId);
    if (!execution) {
      log.warn({ executionId }, 'Execution not found');
      return;
    }

    if (execution.status !== 'active') {
      log.debug({ executionId, status: execution.status }, 'Execution not active — skipping');
      return;
    }

    // Use provided nodeId (from Kafka event) or fall back to currentNodeId (backward compat)
    const targetNodeId = nodeId || execution.currentNodeId;
    if (!targetNodeId) {
      log.warn({ executionId }, 'No target node — marking complete');
      await this.completeExecution(execution);
      return;
    }

    // 2. Load flow
    const flow = await this.flowRepo.findById(execution.restaurantId.toString(), execution.flowId.toString());
    if (!flow) {
      log.error({ executionId, flowId: execution.flowId }, 'Flow not found');
      await this.errorExecution(execution, 'Flow not found');
      return;
    }

    // 3. Load contact
    const contact = await this.contactRepo.findById(
      execution.restaurantId.toString(),
      execution.contactId.toString(),
    );
    if (!contact) {
      log.error({ executionId, contactId: execution.contactId }, 'Contact not found');
      await this.errorExecution(execution, 'Contact not found');
      return;
    }

    // 4. Get target node
    const currentNode = flow.nodes.find((n) => n.id === targetNodeId);
    if (!currentNode) {
      log.error({ executionId, nodeId: targetNodeId }, 'Node not found in flow');
      // Error isolation: move this node from pendingNodes to erroredNodes
      const updated = await this.executionRepo.errorNode(executionId, targetNodeId);
      await this.checkExecutionCompletion(updated, execution);
      return;
    }

    // 5. Enrich context with restaurant data
    const enrichedContext = await this.enrichContext(execution);

    // 6. Process the node with error isolation
    try {
      const { paused } = await this.processNode(execution, flow, contact, currentNode, enrichedContext);

      // If node paused (timer), don't track completion — timer processor handles it
      if (!paused) {
        // Move node from pendingNodes to completedNodes
        const updated = await this.executionRepo.completeNode(executionId, targetNodeId);
        await this.checkExecutionCompletion(updated, execution);
      }
    } catch (err) {
      log.error({ err, executionId, nodeId: currentNode.id }, 'Error processing node');
      await this.logNodeExecution(execution, currentNode, 'failure', `Error: ${(err as Error).message}`);

      // Error isolation: move from pendingNodes to erroredNodes (sibling branches continue)
      const updated = await this.executionRepo.errorNode(executionId, targetNodeId);
      await this.checkExecutionCompletion(updated, execution);
    }
  }

  /**
   * Process a single node.
   * Returns { paused: true } if execution is paused (timer nodes).
   * For non-paused nodes, the caller handles pendingNodes tracking.
   */
  private async processNode(
    execution: IFlowExecutionDocument,
    flow: IFlowDocument,
    contact: IContactDocument,
    node: IFlowNode,
    context: Record<string, unknown>,
  ): Promise<{ paused: boolean }> {
    const restaurantId = execution.restaurantId.toString();
    const executionId = execution._id.toString();
    const flowId = flow._id.toString();

    log.info({ executionId, nodeId: node.id, nodeType: node.type, subType: node.subType }, 'Processing node');

    switch (node.type) {
      case 'trigger': {
        // Trigger nodes just advance to the next node (already logged on enrollment)
        await this.logNodeExecution(execution, node, 'success', 'Trigger processed');
        await this.advanceToNext(execution, flow, node, null);
        return { paused: false };
      }

      case 'action': {
        const result: ActionResult = await this.actionService.execute(
          node, contact, restaurantId, context, executionId, flowId,
        );
        await this.logNodeExecution(
          execution, node,
          result.success ? 'success' : 'failure',
          `Action ${node.subType}: ${result.success ? 'completed' : result.error}`,
          result.metadata,
        );
        // Continue to downstream nodes (action chaining / fan-out)
        await this.advanceToNext(execution, flow, node, null);
        return { paused: false };
      }

      case 'condition': {
        const triggerNode = flow.nodes.find((n) => n.type === 'trigger') ?? node;
        const conditionResult: ConditionResult = this.conditionService.evaluate(
          node, triggerNode, contact, context,
        );
        await this.logNodeExecution(
          execution, node, 'success',
          `Condition evaluated: ${conditionResult.reason}`,
          { handle: conditionResult.handle },
        );
        await this.advanceToNext(execution, flow, node, conditionResult.handle);
        return { paused: false };
      }

      case 'timer': {
        const timerResult = await this.timerService.scheduleTimer(
          node, executionId, restaurantId,
        );

        if (timerResult) {
          const { targetDate } = timerResult;
          await this.logNodeExecution(
            execution, node, 'success',
            `Timer scheduled for ${targetDate.toISOString()}`,
            { targetDate: targetDate.toISOString() },
          );
          // STOP processing — timer will resume via BullMQ FlowTimerProcessor
          // Timer node stays in pendingNodes until the timer fires
          log.info({ executionId, targetDate }, 'Execution paused for timer');
          return { paused: true };
        } else {
          await this.logNodeExecution(execution, node, 'skipped', 'Timer could not be scheduled');
          await this.advanceToNext(execution, flow, node, null);
          return { paused: false };
        }
      }

      case 'logic': {
        log.error({ executionId, nodeId: node.id }, 'Legacy logic node encountered — completing execution');
        await this.logNodeExecution(execution, node, 'skipped', 'Legacy logic node type not supported');
        await this.completeExecution(execution);
        return { paused: true }; // Handled directly — don't track in pendingNodes
      }

      default:
        log.warn({ nodeType: node.type }, 'Unknown node type');
        await this.logNodeExecution(execution, node, 'skipped', `Unknown node type: ${node.type}`);
        await this.advanceToNext(execution, flow, node, null);
        return { paused: false };
    }
  }

  /**
   * Advance to the next node(s) following edges from the current node.
   * Supports fan-out: if multiple outgoing edges exist, dispatches a
   * separate Kafka event for each target node (parallel execution).
   */
  private async advanceToNext(
    execution: IFlowExecutionDocument,
    flow: IFlowDocument,
    currentNode: IFlowNode,
    handle: string | null,
  ): Promise<void> {
    const executionId = execution._id.toString();

    // Find ALL outgoing edges (fan-out support)
    let edges: IFlowEdge[];
    if (handle) {
      // Condition nodes: follow only the branch matching the handle
      edges = flow.edges.filter(
        (e) => e.sourceNodeId === currentNode.id && e.sourceHandle === handle,
      );
    } else {
      // Non-condition nodes: follow ALL outgoing edges
      edges = flow.edges.filter((e) => e.sourceNodeId === currentNode.id);
    }

    if (edges.length === 0) {
      // No outgoing edges — this branch is a leaf node
      // Completion is determined by the caller via pendingNodes check
      log.info({ executionId, nodeId: currentNode.id }, 'No outgoing edges — branch complete');
      return;
    }

    const targetNodeIds = edges.map((e) => e.targetNodeId);

    // Add all target nodeIds to pendingNodes atomically (before producing events)
    await this.executionRepo.addToPendingNodes(executionId, targetNodeIds);

    // Update currentNodeId for backward compat (first target)
    await this.executionRepo.advanceToNode(executionId, targetNodeIds[0]);

    // Produce a flow.step.ready event for each target node
    for (const edge of edges) {
      try {
        await produceFlowStepReady(executionId, edge.targetNodeId);
      } catch (err) {
        log.error({ err, executionId, targetNodeId: edge.targetNodeId }, 'Failed to produce flow.step.ready — processing synchronously');
        // Fallback: process synchronously
        await this.processCurrentNode(executionId, edge.targetNodeId);
      }
    }
  }

  /**
   * Mark an execution as completed.
   */
  private async completeExecution(execution: IFlowExecutionDocument): Promise<void> {
    await this.executionRepo.markCompleted(execution._id.toString());
    await this.flowRepo.recordCompletion(execution.flowId.toString());
    log.info({ executionId: execution._id, flowId: execution.flowId }, 'Execution completed');
  }

  /**
   * Check if execution is fully complete after a node finishes.
   * Called after atomically moving a node from pendingNodes to completedNodes/erroredNodes.
   * If pendingNodes is empty, all branches have resolved — determine final status.
   */
  private async checkExecutionCompletion(
    updated: IFlowExecutionDocument | null,
    execution: IFlowExecutionDocument,
  ): Promise<void> {
    if (!updated) return;

    if (updated.pendingNodes.length === 0) {
      // All branches have resolved
      if (updated.erroredNodes.length > 0 && updated.completedNodes.length === 0) {
        // All branches errored — mark execution as error
        await this.errorExecution(execution, 'All branches errored');
      } else {
        // At least some branches completed (may have partial errors) — mark as completed
        await this.completeExecution(execution);
      }
    }
  }

  /**
   * Mark an execution as errored.
   */
  private async errorExecution(execution: IFlowExecutionDocument, errorMsg: string): Promise<void> {
    await this.executionRepo.markError(execution._id.toString(), { error: errorMsg });
    await this.flowRepo.decrementActiveEnrollments(execution.flowId.toString());
    log.error({ executionId: execution._id, error: errorMsg }, 'Execution errored');
  }

  /**
   * Log a node execution step.
   */
  private async logNodeExecution(
    execution: IFlowExecutionDocument,
    node: IFlowNode,
    result: 'success' | 'failure' | 'skipped',
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.logRepo.create({
      executionId: execution._id,
      flowId: execution.flowId,
      restaurantId: execution.restaurantId,
      contactId: execution.contactId,
      nodeId: node.id,
      nodeType: node.type,
      action,
      result,
      error: result === 'failure' ? action : null,
      metadata: metadata ?? {},
      executedAt: new Date(),
    } as Partial<IFlowExecutionLogDocument>);
  }

  /**
   * Enrich execution context with restaurant data and timezone.
   */
  private async enrichContext(
    execution: IFlowExecutionDocument,
  ): Promise<Record<string, unknown>> {
    const context = { ...(execution.context ?? {}) };
    const restaurantId = execution.restaurantId.toString();

    // Load restaurant data if not already in context
    if (!context._restaurant) {
      const restaurant = await Restaurant.findById(restaurantId).lean().exec();
      if (restaurant) {
        context._restaurant = restaurant;
      }
    }

    // Load timezone if not already in context
    if (!context._timezone) {
      const storeHours = await StoreHours.findOne({ restaurantId: execution.restaurantId }).lean().exec();
      context._timezone = storeHours?.timezone ?? 'UTC';
    }

    return context;
  }
}
