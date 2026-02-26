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
import { getProducer } from '../config/kafka.js';
import { KAFKA_TOPICS } from '../kafka/topics.js';
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

    // Create execution record
    const execution = await this.executionRepo.create({
      flowId,
      restaurantId,
      contactId,
      status: 'active',
      currentNodeId: triggerNode.id,
      context,
    } as any);

    // Increment enrollment stats
    await this.flowRepo.incrementEnrollments(flowId);

    log.info({ restaurantId, flowId, contactId, executionId: execution._id }, 'Contact enrolled in flow');

    // Begin DAG traversal
    await this.processCurrentNode(execution._id.toString());
  }

  /**
   * Process the current node for a flow execution.
   * This is the main entry point called by Kafka consumers when
   * a `flow.step.ready` event is received.
   *
   * @param executionId - The flow execution ID
   */
  async processCurrentNode(executionId: string): Promise<void> {
    // 1. Load execution
    const execution = await this.executionRepo.findOne('', { _id: executionId } as any);
    if (!execution) {
      log.warn({ executionId }, 'Execution not found');
      return;
    }

    if (execution.status !== 'active') {
      log.debug({ executionId, status: execution.status }, 'Execution not active — skipping');
      return;
    }

    if (!execution.currentNodeId) {
      log.warn({ executionId }, 'No current node — marking complete');
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

    // 4. Get current node
    const currentNode = flow.nodes.find((n) => n.id === execution.currentNodeId);
    if (!currentNode) {
      log.error({ executionId, nodeId: execution.currentNodeId }, 'Node not found in flow');
      await this.errorExecution(execution, `Node ${execution.currentNodeId} not found`);
      return;
    }

    // 5. Enrich context with restaurant data
    const enrichedContext = await this.enrichContext(execution);

    // 6. Process the node
    try {
      await this.processNode(execution, flow, contact, currentNode, enrichedContext);
    } catch (err) {
      log.error({ err, executionId, nodeId: currentNode.id }, 'Error processing node');
      await this.logNodeExecution(execution, currentNode, 'failure', `Error: ${(err as Error).message}`);
      await this.errorExecution(execution, (err as Error).message);
    }
  }

  /**
   * Process a single node.
   */
  private async processNode(
    execution: IFlowExecutionDocument,
    flow: IFlowDocument,
    contact: IContactDocument,
    node: IFlowNode,
    context: Record<string, unknown>,
  ): Promise<void> {
    const restaurantId = execution.restaurantId.toString();
    const executionId = execution._id.toString();
    const flowId = flow._id.toString();

    log.info({ executionId, nodeId: node.id, nodeType: node.type, subType: node.subType }, 'Processing node');

    switch (node.type) {
      case 'trigger': {
        // Trigger nodes just advance to the next node (already logged on enrollment)
        await this.logNodeExecution(execution, node, 'success', 'Trigger processed');
        await this.advanceToNext(execution, flow, node, null);
        break;
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
        // Continue even if action fails (log the failure, don't stop the flow)
        await this.advanceToNext(execution, flow, node, null);
        break;
      }

      case 'condition': {
        const conditionResult: ConditionResult = this.conditionService.evaluate(
          node, contact, context,
        );
        await this.logNodeExecution(
          execution, node, 'success',
          `Condition evaluated: ${conditionResult.reason}`,
          { handle: conditionResult.handle },
        );
        await this.advanceToNext(execution, flow, node, conditionResult.handle);
        break;
      }

      case 'timer': {
        // Get restaurant timezone
        const timezone = (context._timezone as string) ?? 'UTC';

        const timerResult = await this.timerService.scheduleTimer(
          node, contact, executionId, timezone,
        );

        if (timerResult) {
          const { targetDate } = timerResult;
          await this.logNodeExecution(
            execution, node, 'success',
            `Timer scheduled for ${targetDate.toISOString()}`,
            { targetDate: targetDate.toISOString() },
          );
          // STOP processing — timer will resume via BullMQ
          log.info({ executionId, targetDate }, 'Execution paused for timer');
        } else {
          await this.logNodeExecution(execution, node, 'skipped', 'Timer could not be scheduled');
          await this.advanceToNext(execution, flow, node, null);
        }
        break;
      }

      case 'logic': {
        await this.processLogicNode(execution, flow, node, contact, context);
        break;
      }

      default:
        log.warn({ nodeType: node.type }, 'Unknown node type');
        await this.logNodeExecution(execution, node, 'skipped', `Unknown node type: ${node.type}`);
        await this.advanceToNext(execution, flow, node, null);
    }
  }

  /**
   * Process a logic node (stop, loop, until_condition, smart_date_sequence, etc.).
   */
  private async processLogicNode(
    execution: IFlowExecutionDocument,
    flow: IFlowDocument,
    node: IFlowNode,
    contact: IContactDocument,
    context: Record<string, unknown>,
  ): Promise<void> {
    switch (node.subType) {
      case 'stop': {
        await this.logNodeExecution(execution, node, 'success', 'Flow stopped');
        await this.completeExecution(execution);
        break;
      }

      case 'loop': {
        const maxIterations = (node.config.maxIterations as number) ?? 10;
        const iterationKey = `_loop_${node.id}`;
        const currentIteration = ((context[iterationKey] as number) ?? 0) + 1;

        if (currentIteration > maxIterations) {
          await this.logNodeExecution(execution, node, 'success', `Loop completed after ${maxIterations} iterations`);
          await this.advanceToNext(execution, flow, node, null);
        } else {
          await this.executionRepo.advanceToNode(execution._id.toString(), node.id, {
            [iterationKey]: currentIteration,
          });
          await this.logNodeExecution(execution, node, 'success', `Loop iteration ${currentIteration}/${maxIterations}`);
          // Re-enter the loop body (advance to next)
          await this.advanceToNext(execution, flow, node, 'loop_body');
        }
        break;
      }

      case 'until_condition': {
        const condResult = this.conditionService.evaluate(node, contact, context);
        if (condResult.handle === 'yes') {
          await this.logNodeExecution(execution, node, 'success', 'Until condition met — advancing');
          await this.advanceToNext(execution, flow, node, 'met');
        } else {
          await this.logNodeExecution(execution, node, 'success', 'Until condition not met — looping');
          await this.advanceToNext(execution, flow, node, 'not_met');
        }
        break;
      }

      default: {
        await this.logNodeExecution(execution, node, 'success', `Logic node: ${node.subType}`);
        await this.advanceToNext(execution, flow, node, null);
      }
    }
  }

  /**
   * Advance to the next node following the edge from the current node.
   */
  private async advanceToNext(
    execution: IFlowExecutionDocument,
    flow: IFlowDocument,
    currentNode: IFlowNode,
    handle: string | null,
  ): Promise<void> {
    // Find outgoing edge matching the handle
    let edge: IFlowEdge | undefined;
    if (handle) {
      edge = flow.edges.find(
        (e) => e.sourceNodeId === currentNode.id && e.sourceHandle === handle,
      );
    }
    // Fallback: find any outgoing edge from this node
    if (!edge) {
      edge = flow.edges.find((e) => e.sourceNodeId === currentNode.id);
    }

    if (!edge) {
      // No outgoing edge — flow is complete
      log.info({ executionId: execution._id, nodeId: currentNode.id }, 'No outgoing edge — completing');
      await this.completeExecution(execution);
      return;
    }

    const nextNodeId = edge.targetNodeId;

    // Update execution record
    await this.executionRepo.advanceToNode(execution._id.toString(), nextNodeId);

    // Produce flow.step.ready event to Kafka for async processing
    try {
      const producer = getProducer();
      await producer.send({
        topic: KAFKA_TOPICS.CRM_FLOW_EXECUTE,
        messages: [
          {
            key: execution._id.toString(),
            value: JSON.stringify({
              eventType: 'flow.step.ready',
              executionId: execution._id.toString(),
              nextNodeId,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch (err) {
      log.error({ err, executionId: execution._id }, 'Failed to produce flow.step.ready — processing synchronously');
      // Fallback: process synchronously (less ideal but keeps flow moving)
      execution.currentNodeId = nextNodeId;
      await this.processCurrentNode(execution._id.toString());
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
