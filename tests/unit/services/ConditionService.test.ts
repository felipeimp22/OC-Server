/**
 * @fileoverview Unit tests for ConditionService.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/config/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ConditionService } from '@/services/ConditionService.js';
import type { IFlowNode } from '@/domain/models/crm/Flow.js';
import type { IContactDocument } from '@/domain/models/crm/Contact.js';

function makeNode(subType: string, config: Record<string, unknown>): IFlowNode {
  return { id: 'node-1', type: 'condition', subType, config } as IFlowNode;
}

function makeContact(overrides: Partial<IContactDocument> = {}): IContactDocument {
  return {
    totalOrders: 0,
    lifetimeValue: 0,
    lifecycleStatus: 'lead',
    tags: [],
    customFields: {},
    emailOptIn: true,
    smsOptIn: false,
    ...overrides,
  } as unknown as IContactDocument;
}

describe('ConditionService', () => {
  let service: ConditionService;

  beforeEach(() => {
    service = new ConditionService();
  });

  describe('evaluate — yes_no', () => {
    it('PRD test: contact { totalOrders: 5 } + greater_than 3 → yes', () => {
      const node = makeNode('yes_no', {
        conditions: [{ field: 'totalOrders', operator: 'greater_than', value: 3 }],
        operator: 'AND',
      });
      const contact = makeContact({ totalOrders: 5 });
      const result = service.evaluate(node, contact, {});
      expect(result.handle).toBe('yes');
    });

    it('PRD test: contact { emailOptIn: false } + equals true → no', () => {
      const node = makeNode('yes_no', {
        conditions: [{ field: 'emailOptIn', operator: 'equals', value: true }],
        operator: 'AND',
      });
      const contact = makeContact({ emailOptIn: false });
      const result = service.evaluate(node, contact, {});
      expect(result.handle).toBe('no');
    });

    it('greater_than — contact value equals threshold → no', () => {
      const node = makeNode('yes_no', {
        conditions: [{ field: 'totalOrders', operator: 'greater_than', value: 5 }],
        operator: 'AND',
      });
      const result = service.evaluate(node, makeContact({ totalOrders: 5 }), {});
      expect(result.handle).toBe('no');
    });

    it('less_than — lifetimeValue', () => {
      const node = makeNode('yes_no', {
        conditions: [{ field: 'lifetimeValue', operator: 'less_than', value: 100 }],
        operator: 'AND',
      });
      expect(service.evaluate(node, makeContact({ lifetimeValue: 50 }), {}).handle).toBe('yes');
      expect(service.evaluate(node, makeContact({ lifetimeValue: 150 }), {}).handle).toBe('no');
    });

    it('equals — lifecycleStatus', () => {
      const node = makeNode('yes_no', {
        conditions: [{ field: 'lifecycleStatus', operator: 'equals', value: 'VIP' }],
        operator: 'AND',
      });
      expect(service.evaluate(node, makeContact({ lifecycleStatus: 'VIP' }), {}).handle).toBe('yes');
      expect(service.evaluate(node, makeContact({ lifecycleStatus: 'lead' }), {}).handle).toBe('no');
    });

    it('not_equals operator', () => {
      const node = makeNode('yes_no', {
        conditions: [{ field: 'lifecycleStatus', operator: 'not_equals', value: 'lead' }],
        operator: 'AND',
      });
      expect(service.evaluate(node, makeContact({ lifecycleStatus: 'VIP' }), {}).handle).toBe('yes');
      expect(service.evaluate(node, makeContact({ lifecycleStatus: 'lead' }), {}).handle).toBe('no');
    });

    it('contains — string field', () => {
      const node = makeNode('yes_no', {
        conditions: [{ field: 'email', operator: 'contains', value: '@example' }],
        operator: 'AND',
      });
      const contact = makeContact({ email: 'user@example.com' } as any);
      expect(service.evaluate(node, contact, {}).handle).toBe('yes');
    });

    it('not_contains — string field', () => {
      const node = makeNode('yes_no', {
        conditions: [{ field: 'email', operator: 'not_contains', value: '@spam' }],
        operator: 'AND',
      });
      const contact = makeContact({ email: 'user@example.com' } as any);
      expect(service.evaluate(node, contact, {}).handle).toBe('yes');
    });

    it('exists / not_exists operators', () => {
      const existsNode = makeNode('yes_no', {
        conditions: [{ field: 'customFields.referral', operator: 'exists', value: null }],
        operator: 'AND',
      });
      const notExistsNode = makeNode('yes_no', {
        conditions: [{ field: 'customFields.referral', operator: 'not_exists', value: null }],
        operator: 'AND',
      });

      const withField = makeContact({ customFields: { referral: 'google' } });
      const withoutField = makeContact({ customFields: {} });

      expect(service.evaluate(existsNode, withField, {}).handle).toBe('yes');
      expect(service.evaluate(existsNode, withoutField, {}).handle).toBe('no');
      expect(service.evaluate(notExistsNode, withoutField, {}).handle).toBe('yes');
      expect(service.evaluate(notExistsNode, withField, {}).handle).toBe('no');
    });

    it('customFields.<key> dot-notation field resolution', () => {
      const node = makeNode('yes_no', {
        conditions: [{ field: 'customFields.vipTier', operator: 'equals', value: 'gold' }],
        operator: 'AND',
      });
      const contact = makeContact({ customFields: { vipTier: 'gold' } });
      expect(service.evaluate(node, contact, {}).handle).toBe('yes');
    });

    it('AND operator — all conditions must pass', () => {
      const node = makeNode('yes_no', {
        conditions: [
          { field: 'totalOrders', operator: 'greater_than', value: 3 },
          { field: 'emailOptIn', operator: 'equals', value: true },
        ],
        operator: 'AND',
      });
      expect(service.evaluate(node, makeContact({ totalOrders: 5, emailOptIn: true }), {}).handle).toBe('yes');
      expect(service.evaluate(node, makeContact({ totalOrders: 5, emailOptIn: false }), {}).handle).toBe('no');
    });

    it('OR operator — any condition passing is sufficient', () => {
      const node = makeNode('yes_no', {
        conditions: [
          { field: 'totalOrders', operator: 'greater_than', value: 100 },
          { field: 'emailOptIn', operator: 'equals', value: true },
        ],
        operator: 'OR',
      });
      expect(service.evaluate(node, makeContact({ totalOrders: 1, emailOptIn: true }), {}).handle).toBe('yes');
      expect(service.evaluate(node, makeContact({ totalOrders: 1, emailOptIn: false }), {}).handle).toBe('no');
    });
  });

  describe('evaluate — unsupported subtypes', () => {
    it('ab_split → yes with not implemented reason', () => {
      const node = makeNode('ab_split', {});
      const result = service.evaluate(node, makeContact(), {});
      expect(result.handle).toBe('yes');
      expect(result.reason).toContain('not implemented');
    });

    it('multi_branch → yes with not implemented reason', () => {
      const node = makeNode('multi_branch', {});
      const result = service.evaluate(node, makeContact(), {});
      expect(result.handle).toBe('yes');
      expect(result.reason).toContain('not implemented');
    });

    it('random_distribution → yes with not implemented reason', () => {
      const node = makeNode('random_distribution', {});
      const result = service.evaluate(node, makeContact(), {});
      expect(result.handle).toBe('yes');
      expect(result.reason).toContain('not implemented');
    });

    it('unknown subtype → yes with not implemented reason', () => {
      const node = makeNode('unknown_type', {});
      const result = service.evaluate(node, makeContact(), {});
      expect(result.handle).toBe('yes');
      expect(result.reason).toContain('not implemented');
    });
  });
});
