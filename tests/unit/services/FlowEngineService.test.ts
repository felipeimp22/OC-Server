/**
 * @fileoverview Unit tests for FlowEngineService.
 *
 * Covers:
 * - enrollContact: isContactEnrolled check, FlowExecution creation, incrementEnrollments, processCurrentNode
 * - processCurrentNode: dispatching by node type (trigger, action, condition, timer, logic/stop)
 * - completeExecution: marks completed, records completion in flow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/config/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/config/kafka.js', () => ({
  getProducer: vi.fn(() => ({
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/kafka/topics.js', () => ({
  KAFKA_TOPICS: {
    CRM_FLOW_EXECUTE: 'crm.flow.execute',
  },
}));

vi.mock('@/domain/models/external/Restaurant.js', () => ({
  Restaurant: {
    findById: vi.fn(() => ({
      lean: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
    })),
  },
}));

vi.mock('@/domain/models/external/StoreHours.js', () => ({
  StoreHours: {
    findOne: vi.fn(() => ({
      lean: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
    })),
  },
}));

const mockFlowRepo = {
  findById: vi.fn(),
  incrementEnrollments: vi.fn(),
  recordCompletion: vi.fn(),
  decrementActiveEnrollments: vi.fn(),
};
vi.mock('@/repositories/FlowRepository.js', () => ({
  FlowRepository: vi.fn(() => mockFlowRepo),
}));

const mockExecutionRepo = {
  create: vi.fn(),
  findByExecutionId: vi.fn(),
  isContactEnrolled: vi.fn(),
  advanceToNode: vi.fn(),
  markCompleted: vi.fn(),
  markError: vi.fn(),
};
vi.mock('@/repositories/FlowExecutionRepository.js', () => ({
  FlowExecutionRepository: vi.fn(() => mockExecutionRepo),
}));

const mockLogRepo = {
  create: vi.fn(),
};
vi.mock('@/repositories/FlowExecutionLogRepository.js', () => ({
  FlowExecutionLogRepository: vi.fn(() => mockLogRepo),
}));

const mockContactRepo = {
  findById: vi.fn(),
};
vi.mock('@/repositories/ContactRepository.js', () => ({
  ContactRepository: vi.fn(() => mockContactRepo),
}));

const mockConditionService = {
  evaluate: vi.fn(),
};
vi.mock('@/services/ConditionService.js', () => ({
  ConditionService: vi.fn(() => mockConditionService),
}));

const mockActionService = {
  execute: vi.fn(),
};
vi.mock('@/services/ActionService.js', () => ({
  ActionService: vi.fn(() => mockActionService),
}));

const mockTimerService = {
  scheduleTimer: vi.fn(),
};
vi.mock('@/services/TimerService.js', () => ({
  TimerService: vi.fn(() => mockTimerService),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

import { FlowEngineService } from '@/services/FlowEngineService.js';

const REST = 'rest-1';
const FLOW_ID = 'flow-1';
const CONTACT_ID = 'contact-1';
const EXEC_ID = 'exec-1';

function makeFlow(nodes: object[], edges: object[] = []) {
  return {
    _id: { toString: () => FLOW_ID },
    restaurantId: { toString: () => REST },
    nodes,
    edges,
  };
}

function makeExecution(nodeId: string | null, status = 'active') {
  return {
    _id: { toString: () => EXEC_ID },
    flowId: { toString: () => FLOW_ID },
    restaurantId: { toString: () => REST },
    contactId: { toString: () => CONTACT_ID },
    currentNodeId: nodeId,
    status,
    context: {},
  };
}

function makeContact() {
  return { _id: CONTACT_ID, restaurantId: REST };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FlowEngineService', () => {
  let service: FlowEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FlowEngineService();
  });

  // ── enrollContact ──────────────────────────────────────────────────────────

  describe('enrollContact', () => {
    it('skips if contact is already enrolled', async () => {
      mockFlowRepo.findById.mockResolvedValue(
        makeFlow([{ id: 'n1', type: 'trigger' }]),
      );
      mockExecutionRepo.isContactEnrolled.mockResolvedValue(true);

      await service.enrollContact(REST, FLOW_ID, CONTACT_ID, {});

      expect(mockExecutionRepo.create).not.toHaveBeenCalled();
    });

    it('skips if flow has no trigger node', async () => {
      mockFlowRepo.findById.mockResolvedValue(makeFlow([]));
      mockExecutionRepo.isContactEnrolled.mockResolvedValue(false);

      await service.enrollContact(REST, FLOW_ID, CONTACT_ID, {});

      expect(mockExecutionRepo.create).not.toHaveBeenCalled();
    });

    it('skips if flow not found', async () => {
      mockFlowRepo.findById.mockResolvedValue(null);

      await service.enrollContact(REST, FLOW_ID, CONTACT_ID, {});

      expect(mockExecutionRepo.create).not.toHaveBeenCalled();
    });

    it('creates execution with trigger node as currentNodeId and increments enrollments', async () => {
      const triggerNode = { id: 'trigger-1', type: 'trigger', subType: 'order_completed' };
      const flow = makeFlow([triggerNode]);
      mockFlowRepo.findById.mockResolvedValue(flow);
      mockExecutionRepo.isContactEnrolled.mockResolvedValue(false);

      const createdExec = makeExecution('trigger-1');
      mockExecutionRepo.create.mockResolvedValue(createdExec);

      // processCurrentNode will be called — mock the execution lookup to avoid deep recursion
      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('trigger-1', 'active'));
      mockFlowRepo.findById.mockResolvedValueOnce(flow).mockResolvedValue(flow);
      mockContactRepo.findById.mockResolvedValue(makeContact());

      // For the trigger node, advanceToNext will look for outgoing edge — none found → completeExecution
      mockExecutionRepo.markCompleted.mockResolvedValue(null);
      mockFlowRepo.recordCompletion.mockResolvedValue(undefined);
      mockLogRepo.create.mockResolvedValue(null);

      await service.enrollContact(REST, FLOW_ID, CONTACT_ID, { orderTotal: 50 });

      expect(mockExecutionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          flowId: FLOW_ID,
          restaurantId: REST,
          contactId: CONTACT_ID,
          status: 'active',
          currentNodeId: 'trigger-1',
        }),
      );
      expect(mockFlowRepo.incrementEnrollments).toHaveBeenCalledWith(FLOW_ID);
    });
  });

  // ── processCurrentNode ─────────────────────────────────────────────────────

  describe('processCurrentNode', () => {
    it('returns early if execution not found', async () => {
      mockExecutionRepo.findByExecutionId.mockResolvedValue(null);

      await service.processCurrentNode(EXEC_ID);

      expect(mockFlowRepo.findById).not.toHaveBeenCalled();
    });

    it('returns early if execution is not active', async () => {
      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1', 'completed'));

      await service.processCurrentNode(EXEC_ID);

      expect(mockFlowRepo.findById).not.toHaveBeenCalled();
    });

    it('completes if no currentNodeId', async () => {
      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution(null, 'active'));
      mockExecutionRepo.markCompleted.mockResolvedValue(null);
      mockFlowRepo.recordCompletion.mockResolvedValue(undefined);

      await service.processCurrentNode(EXEC_ID);

      expect(mockExecutionRepo.markCompleted).toHaveBeenCalledWith(EXEC_ID);
      expect(mockFlowRepo.recordCompletion).toHaveBeenCalledWith(FLOW_ID);
    });

    it('errors if flow not found', async () => {
      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1'));
      mockFlowRepo.findById.mockResolvedValue(null);
      mockExecutionRepo.markError.mockResolvedValue(null);
      mockFlowRepo.decrementActiveEnrollments.mockResolvedValue(undefined);

      await service.processCurrentNode(EXEC_ID);

      expect(mockExecutionRepo.markError).toHaveBeenCalledWith(
        EXEC_ID,
        expect.objectContaining({ error: 'Flow not found' }),
      );
    });

    it('errors if contact not found', async () => {
      const triggerNode = { id: 'n1', type: 'trigger' };
      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1'));
      mockFlowRepo.findById.mockResolvedValue(makeFlow([triggerNode]));
      mockContactRepo.findById.mockResolvedValue(null);
      mockExecutionRepo.markError.mockResolvedValue(null);
      mockFlowRepo.decrementActiveEnrollments.mockResolvedValue(undefined);

      await service.processCurrentNode(EXEC_ID);

      expect(mockExecutionRepo.markError).toHaveBeenCalledWith(
        EXEC_ID,
        expect.objectContaining({ error: 'Contact not found' }),
      );
    });

    it('processes trigger node → advances to next via outgoing edge → publishes flow.step.ready', async () => {
      const triggerNode = { id: 'n1', type: 'trigger', subType: 'order_completed' };
      const actionNode = { id: 'n2', type: 'action', subType: 'send_email' };
      const edge = { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' };
      const flow = makeFlow([triggerNode, actionNode], [edge]);

      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1'));
      mockFlowRepo.findById.mockResolvedValue(flow);
      mockContactRepo.findById.mockResolvedValue(makeContact());
      mockLogRepo.create.mockResolvedValue(null);
      mockExecutionRepo.advanceToNode.mockResolvedValue(null);

      await service.processCurrentNode(EXEC_ID);

      expect(mockExecutionRepo.advanceToNode).toHaveBeenCalledWith(EXEC_ID, 'n2');
    });

    it('processes trigger node with no outgoing edge → completes execution', async () => {
      const triggerNode = { id: 'n1', type: 'trigger', subType: 'order_completed' };
      const flow = makeFlow([triggerNode], []); // no edges

      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1'));
      mockFlowRepo.findById.mockResolvedValue(flow);
      mockContactRepo.findById.mockResolvedValue(makeContact());
      mockLogRepo.create.mockResolvedValue(null);
      mockExecutionRepo.markCompleted.mockResolvedValue(null);
      mockFlowRepo.recordCompletion.mockResolvedValue(undefined);

      await service.processCurrentNode(EXEC_ID);

      expect(mockExecutionRepo.markCompleted).toHaveBeenCalledWith(EXEC_ID);
      expect(mockFlowRepo.recordCompletion).toHaveBeenCalledWith(FLOW_ID);
    });

    it('processes action node → calls ActionService.execute → advances', async () => {
      const actionNode = { id: 'n1', type: 'action', subType: 'send_email', config: {} };
      const flow = makeFlow([actionNode], []);

      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1'));
      mockFlowRepo.findById.mockResolvedValue(flow);
      mockContactRepo.findById.mockResolvedValue(makeContact());
      mockActionService.execute.mockResolvedValue({ success: true, action: 'send_email' });
      mockLogRepo.create.mockResolvedValue(null);
      mockExecutionRepo.markCompleted.mockResolvedValue(null);
      mockFlowRepo.recordCompletion.mockResolvedValue(undefined);

      await service.processCurrentNode(EXEC_ID);

      expect(mockActionService.execute).toHaveBeenCalledWith(
        actionNode,
        expect.anything(), // contact
        REST,
        expect.anything(), // enrichedContext
        EXEC_ID,
        FLOW_ID,
      );
      // No outgoing edge → completeExecution
      expect(mockExecutionRepo.markCompleted).toHaveBeenCalledWith(EXEC_ID);
    });

    it('processes condition node → picks edge by sourceHandle from ConditionService result', async () => {
      const condNode = { id: 'n1', type: 'condition', subType: 'yes_no', config: {} };
      const yesNode = { id: 'n2', type: 'action', subType: 'send_email' };
      const noNode  = { id: 'n3', type: 'action', subType: 'send_sms' };
      const yesEdge = { id: 'e1', sourceNodeId: 'n1', sourceHandle: 'yes', targetNodeId: 'n2' };
      const noEdge  = { id: 'e2', sourceNodeId: 'n1', sourceHandle: 'no',  targetNodeId: 'n3' };
      const flow = makeFlow([condNode, yesNode, noNode], [yesEdge, noEdge]);

      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1'));
      mockFlowRepo.findById.mockResolvedValue(flow);
      mockContactRepo.findById.mockResolvedValue(makeContact());
      mockConditionService.evaluate.mockReturnValue({ handle: 'yes', reason: 'totalOrders > 3' });
      mockLogRepo.create.mockResolvedValue(null);
      mockExecutionRepo.advanceToNode.mockResolvedValue(null);

      await service.processCurrentNode(EXEC_ID);

      expect(mockConditionService.evaluate).toHaveBeenCalledWith(condNode, expect.anything(), expect.anything(), expect.anything());
      // Should advance to the 'yes' branch target node
      expect(mockExecutionRepo.advanceToNode).toHaveBeenCalledWith(EXEC_ID, 'n2');
    });

    it('processes timer node → calls TimerService.scheduleTimer → does NOT advance', async () => {
      const timerNode = { id: 'n1', type: 'timer', subType: 'delay', config: { duration: 1, unit: 'days' } };
      const nextNode  = { id: 'n2', type: 'action', subType: 'send_email' };
      const edge = { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' };
      const flow = makeFlow([timerNode, nextNode], [edge]);

      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1'));
      mockFlowRepo.findById.mockResolvedValue(flow);
      mockContactRepo.findById.mockResolvedValue(makeContact());
      const targetDate = new Date(Date.now() + 86400000);
      mockTimerService.scheduleTimer.mockResolvedValue({ targetDate });
      mockLogRepo.create.mockResolvedValue(null);

      await service.processCurrentNode(EXEC_ID);

      expect(mockTimerService.scheduleTimer).toHaveBeenCalledWith(
        timerNode,
        EXEC_ID,
        expect.any(String), // restaurantId
      );
      // execution must NOT advance — Kafka message is NOT produced and advanceToNode is NOT called
      expect(mockExecutionRepo.advanceToNode).not.toHaveBeenCalled();
      expect(mockExecutionRepo.markCompleted).not.toHaveBeenCalled();
    });

    it('processes timer node when timer cannot be scheduled → advances to next', async () => {
      const timerNode = { id: 'n1', type: 'timer', subType: 'date_field', config: { field: 'missing_field' } };
      const nextNode  = { id: 'n2', type: 'action', subType: 'send_email' };
      const edge = { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' };
      const flow = makeFlow([timerNode, nextNode], [edge]);

      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1'));
      mockFlowRepo.findById.mockResolvedValue(flow);
      mockContactRepo.findById.mockResolvedValue(makeContact());
      mockTimerService.scheduleTimer.mockResolvedValue(null); // null = cannot schedule
      mockLogRepo.create.mockResolvedValue(null);
      mockExecutionRepo.advanceToNode.mockResolvedValue(null);

      await service.processCurrentNode(EXEC_ID);

      expect(mockExecutionRepo.advanceToNode).toHaveBeenCalledWith(EXEC_ID, 'n2');
    });

    it('processes logic/stop node → calls completeExecution', async () => {
      const stopNode = { id: 'n1', type: 'logic', subType: 'stop', config: {} };
      const flow = makeFlow([stopNode], []);

      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1'));
      mockFlowRepo.findById.mockResolvedValue(flow);
      mockContactRepo.findById.mockResolvedValue(makeContact());
      mockLogRepo.create.mockResolvedValue(null);
      mockExecutionRepo.markCompleted.mockResolvedValue(null);
      mockFlowRepo.recordCompletion.mockResolvedValue(undefined);

      await service.processCurrentNode(EXEC_ID);

      expect(mockExecutionRepo.markCompleted).toHaveBeenCalledWith(EXEC_ID);
      expect(mockFlowRepo.recordCompletion).toHaveBeenCalledWith(FLOW_ID);
    });
  });

  // ── completeExecution ──────────────────────────────────────────────────────

  describe('completeExecution (via processCurrentNode with no outgoing edge)', () => {
    it('marks execution completed and records completion in flow', async () => {
      const triggerNode = { id: 'n1', type: 'trigger', subType: 'order_completed' };
      const flow = makeFlow([triggerNode], []);

      mockExecutionRepo.findByExecutionId.mockResolvedValue(makeExecution('n1'));
      mockFlowRepo.findById.mockResolvedValue(flow);
      mockContactRepo.findById.mockResolvedValue(makeContact());
      mockLogRepo.create.mockResolvedValue(null);
      mockExecutionRepo.markCompleted.mockResolvedValue(null);
      mockFlowRepo.recordCompletion.mockResolvedValue(undefined);

      await service.processCurrentNode(EXEC_ID);

      expect(mockExecutionRepo.markCompleted).toHaveBeenCalledWith(EXEC_ID);
      expect(mockFlowRepo.recordCompletion).toHaveBeenCalledWith(FLOW_ID);
    });
  });
});
