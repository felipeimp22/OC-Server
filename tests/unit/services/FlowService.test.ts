/**
 * @fileoverview Unit tests for FlowService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('@/config/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/repositories/FlowRepository.js', () => {
  const mockRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findPaginated: vi.fn(),
    updateById: vi.fn(),
    deleteById: vi.fn(),
    findActiveByTrigger: vi.fn(),
    findSystemFlow: vi.fn(),
    incrementEnrollments: vi.fn(),
    recordCompletion: vi.fn(),
  };

  return {
    FlowRepository: vi.fn(() => mockRepo),
    __mockRepo: mockRepo,
  };
});

import { FlowService } from '@/services/FlowService.js';
// @ts-expect-error — accessing test mock exports
import { __mockRepo as mockFlowRepo } from '@/repositories/FlowRepository.js';

describe('FlowService', () => {
  let service: FlowService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FlowService();
  });

  describe('create', () => {
    it('should create a flow with defaults', async () => {
      const created = {
        _id: 'flow-1',
        restaurantId: 'rest-1',
        name: 'Test Flow',
        status: 'draft',
        isSystem: false,
        version: 1,
        nodes: [],
        edges: [],
      };
      mockFlowRepo.create.mockResolvedValue(created);

      const result = await service.create('rest-1', { name: 'Test Flow' });

      expect(result).toEqual(created);
      expect(mockFlowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: 'rest-1',
          name: 'Test Flow',
          status: 'draft',
          isSystem: false,
        }),
      );
    });

    it('should create a flow with custom nodes and edges', async () => {
      mockFlowRepo.create.mockResolvedValue({ _id: 'flow-2', name: 'Custom Flow' });

      const nodes = [{ id: 'n1', type: 'trigger', subType: 'order_placed', label: '', config: {}, position: { x: 0, y: 0 } }];
      const edges = [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }];

      await service.create('rest-1', {
        name: 'Custom Flow',
        description: 'A flow description',
        nodes: nodes as any,
        edges: edges as any,
      });

      expect(mockFlowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: expect.arrayContaining([expect.objectContaining({ id: 'n1' })]),
          edges: expect.arrayContaining([expect.objectContaining({ sourceNodeId: 'n1' })]),
          description: 'A flow description',
        }),
      );
    });
  });

  describe('getById', () => {
    it('should return a flow by ID', async () => {
      const flow = { _id: 'flow-1', name: 'Test' };
      mockFlowRepo.findById.mockResolvedValue(flow);

      const result = await service.getById('rest-1', 'flow-1');
      expect(result).toEqual(flow);
      expect(mockFlowRepo.findById).toHaveBeenCalledWith('rest-1', 'flow-1');
    });

    it('should return null for non-existent flow', async () => {
      mockFlowRepo.findById.mockResolvedValue(null);

      const result = await service.getById('rest-1', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should return paginated flows', async () => {
      const paginated = {
        data: [{ _id: 'f1' }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasMore: false,
      };
      mockFlowRepo.findPaginated.mockResolvedValue(paginated);

      const result = await service.list('rest-1', {}, { page: 1, limit: 20 });
      expect(result).toEqual(paginated);
    });
  });

  describe('update', () => {
    it('should update a draft flow', async () => {
      mockFlowRepo.findById.mockResolvedValue({ _id: 'f1', status: 'draft' });
      mockFlowRepo.updateById.mockResolvedValue({ _id: 'f1', name: 'Updated', version: 2 });

      const result = await service.update('rest-1', 'f1', { name: 'Updated' });
      expect(result!.name).toBe('Updated');
    });

    it('should throw when updating an active flow', async () => {
      mockFlowRepo.findById.mockResolvedValue({ _id: 'f1', status: 'active' });

      await expect(service.update('rest-1', 'f1', { name: 'New' }))
        .rejects.toThrow('Cannot update an active flow');
    });

    it('should return null for non-existent flow', async () => {
      mockFlowRepo.findById.mockResolvedValue(null);

      const result = await service.update('rest-1', 'nonexistent', { name: 'New' });
      expect(result).toBeNull();
    });
  });

  describe('activate', () => {
    it('should activate a valid flow', async () => {
      const flow = {
        _id: 'f1',
        status: 'draft',
        nodes: [
          { id: 'n1', type: 'trigger' },
          { id: 'n2', type: 'action' },
        ],
      };
      mockFlowRepo.findById.mockResolvedValue(flow);
      mockFlowRepo.updateById.mockResolvedValue({ ...flow, status: 'active' });

      const result = await service.activate('rest-1', 'f1');
      expect(result!.status).toBe('active');
    });

    it('should return flow as-is if already active', async () => {
      const flow = { _id: 'f1', status: 'active' };
      mockFlowRepo.findById.mockResolvedValue(flow);

      const result = await service.activate('rest-1', 'f1');
      expect(result).toEqual(flow);
      expect(mockFlowRepo.updateById).not.toHaveBeenCalled();
    });

    it('should throw when activating an archived flow', async () => {
      mockFlowRepo.findById.mockResolvedValue({ _id: 'f1', status: 'archived' });

      await expect(service.activate('rest-1', 'f1'))
        .rejects.toThrow('Cannot activate an archived flow');
    });

    it('should throw when flow has no trigger node', async () => {
      mockFlowRepo.findById.mockResolvedValue({
        _id: 'f1',
        status: 'draft',
        nodes: [{ id: 'n1', type: 'action' }],
      });

      await expect(service.activate('rest-1', 'f1'))
        .rejects.toThrow('Flow must have at least one trigger node');
    });

    it('should throw when flow has no action node', async () => {
      mockFlowRepo.findById.mockResolvedValue({
        _id: 'f1',
        status: 'draft',
        nodes: [{ id: 'n1', type: 'trigger' }],
      });

      await expect(service.activate('rest-1', 'f1'))
        .rejects.toThrow('Flow must have at least one action node');
    });

    it('should return null for non-existent flow', async () => {
      mockFlowRepo.findById.mockResolvedValue(null);

      const result = await service.activate('rest-1', 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('pause', () => {
    it('should pause a flow', async () => {
      mockFlowRepo.updateById.mockResolvedValue({ _id: 'f1', status: 'paused' });

      const result = await service.pause('rest-1', 'f1');
      expect(result!.status).toBe('paused');
    });
  });

  describe('delete', () => {
    it('should delete a non-system flow', async () => {
      mockFlowRepo.findById.mockResolvedValue({ _id: 'f1', isSystem: false });
      mockFlowRepo.deleteById.mockResolvedValue(true);

      const result = await service.delete('rest-1', 'f1');
      expect(result).toBe(true);
    });

    it('should throw when deleting a system flow', async () => {
      mockFlowRepo.findById.mockResolvedValue({ _id: 'f1', isSystem: true });

      await expect(service.delete('rest-1', 'f1'))
        .rejects.toThrow('System flows cannot be deleted');
    });

    it('should return false for non-existent flow', async () => {
      mockFlowRepo.findById.mockResolvedValue(null);

      const result = await service.delete('rest-1', 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('findActiveByTrigger', () => {
    it('should delegate to repository', async () => {
      const flows = [{ _id: 'f1' }, { _id: 'f2' }];
      mockFlowRepo.findActiveByTrigger.mockResolvedValue(flows);

      const result = await service.findActiveByTrigger('rest-1', 'order_placed');
      expect(result).toEqual(flows);
      expect(mockFlowRepo.findActiveByTrigger).toHaveBeenCalledWith('rest-1', 'order_placed');
    });
  });

  describe('incrementEnrollments', () => {
    it('should delegate to repository', async () => {
      mockFlowRepo.incrementEnrollments.mockResolvedValue(undefined);

      await service.incrementEnrollments('flow-1');
      expect(mockFlowRepo.incrementEnrollments).toHaveBeenCalledWith('flow-1');
    });
  });

  describe('recordCompletion', () => {
    it('should delegate to repository', async () => {
      mockFlowRepo.recordCompletion.mockResolvedValue(undefined);

      await service.recordCompletion('flow-1');
      expect(mockFlowRepo.recordCompletion).toHaveBeenCalledWith('flow-1');
    });
  });
});
