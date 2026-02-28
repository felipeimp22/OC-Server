/**
 * @fileoverview Unit tests for ConditionService (trigger-bound yes/no semantics).
 *
 * US-011: ConditionService now uses 4-param evaluate(conditionNode, triggerNode, contact, eventContext).
 * All filter logic reads from triggerNode.config, not conditionNode.config.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

function makeTriggerNode(subType: string, config: Record<string, unknown> = {}): IFlowNode {
  return { id: 'trigger-1', type: 'trigger', subType, config } as IFlowNode;
}

function makeConditionNode(): IFlowNode {
  return { id: 'cond-1', type: 'condition', subType: 'yes_no', config: {} } as IFlowNode;
}

function makeContact(overrides: Partial<IContactDocument> = {}): IContactDocument {
  return {
    totalOrders: 0,
    lifetimeValue: 0,
    lifecycleStatus: 'lead',
    lastOrderAt: null,
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

  describe('evaluate — order_completed trigger', () => {
    it('no minOrderTotal config → always yes', () => {
      const trigger = makeTriggerNode('order_completed', {});
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), {});
      expect(result.handle).toBe('yes');
    });

    it('minOrderTotal: 50 + order.total=100 → yes', () => {
      const trigger = makeTriggerNode('order_completed', { minOrderTotal: 50 });
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), { order: { total: 100 } });
      expect(result.handle).toBe('yes');
    });

    it('minOrderTotal: 50 + order.total=25 → no', () => {
      const trigger = makeTriggerNode('order_completed', { minOrderTotal: 50 });
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), { order: { total: 25 } });
      expect(result.handle).toBe('no');
    });

    it('minOrderTotal: 50 + order.total=50 (exactly) → yes', () => {
      const trigger = makeTriggerNode('order_completed', { minOrderTotal: 50 });
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), { order: { total: 50 } });
      expect(result.handle).toBe('yes');
    });
  });

  describe('evaluate — first_order trigger', () => {
    it('no minOrderTotal config → always yes', () => {
      const trigger = makeTriggerNode('first_order', {});
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), {});
      expect(result.handle).toBe('yes');
    });

    it('minOrderTotal: 20 + order.total=30 → yes', () => {
      const trigger = makeTriggerNode('first_order', { minOrderTotal: 20 });
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), { order: { total: 30 } });
      expect(result.handle).toBe('yes');
    });
  });

  describe('evaluate — nth_order trigger', () => {
    it('n=5 + contact.totalOrders=5 → yes', () => {
      const trigger = makeTriggerNode('nth_order', { n: 5 });
      const result = service.evaluate(makeConditionNode(), trigger, makeContact({ totalOrders: 5 }), {});
      expect(result.handle).toBe('yes');
    });

    it('n=5 + contact.totalOrders=3 → no', () => {
      const trigger = makeTriggerNode('nth_order', { n: 5 });
      const result = service.evaluate(makeConditionNode(), trigger, makeContact({ totalOrders: 3 }), {});
      expect(result.handle).toBe('no');
    });

    it('no n config → always yes', () => {
      const trigger = makeTriggerNode('nth_order', {});
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), {});
      expect(result.handle).toBe('yes');
    });
  });

  describe('evaluate — order_status_changed trigger', () => {
    it('targetStatus=delivered + order.status=delivered → yes', () => {
      const trigger = makeTriggerNode('order_status_changed', { targetStatus: 'delivered' });
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), { order: { status: 'delivered' } });
      expect(result.handle).toBe('yes');
    });

    it('targetStatus=delivered + order.status=pending → no', () => {
      const trigger = makeTriggerNode('order_status_changed', { targetStatus: 'delivered' });
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), { order: { status: 'pending' } });
      expect(result.handle).toBe('no');
    });

    it('no targetStatus config → always yes', () => {
      const trigger = makeTriggerNode('order_status_changed', {});
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), {});
      expect(result.handle).toBe('yes');
    });
  });

  describe('evaluate — no_order_in_x_days trigger', () => {
    it('x=30 + contact.lastOrderAt=60 days ago → yes', () => {
      const trigger = makeTriggerNode('no_order_in_x_days', { x: 30 });
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
      const result = service.evaluate(makeConditionNode(), trigger, makeContact({ lastOrderAt: sixtyDaysAgo }), {});
      expect(result.handle).toBe('yes');
    });

    it('x=30 + contact.lastOrderAt=10 days ago → no', () => {
      const trigger = makeTriggerNode('no_order_in_x_days', { x: 30 });
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
      const result = service.evaluate(makeConditionNode(), trigger, makeContact({ lastOrderAt: tenDaysAgo }), {});
      expect(result.handle).toBe('no');
    });

    it('x=30 + contact.lastOrderAt=null (no orders) → yes (Infinity >= x)', () => {
      const trigger = makeTriggerNode('no_order_in_x_days', { x: 30 });
      const result = service.evaluate(makeConditionNode(), trigger, makeContact({ lastOrderAt: null }), {});
      expect(result.handle).toBe('yes');
    });

    it('no x config → always yes', () => {
      const trigger = makeTriggerNode('no_order_in_x_days', {});
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), {});
      expect(result.handle).toBe('yes');
    });
  });

  describe('evaluate — triggers with no filter config (always yes)', () => {
    it('payment_failed → always yes', () => {
      const trigger = makeTriggerNode('payment_failed', {});
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), {});
      expect(result.handle).toBe('yes');
    });

    it('abandoned_cart → always yes', () => {
      const trigger = makeTriggerNode('abandoned_cart', {});
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), {});
      expect(result.handle).toBe('yes');
    });

    it('unknown trigger subtype → always yes', () => {
      const trigger = makeTriggerNode('some_unknown_trigger', {});
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), {});
      expect(result.handle).toBe('yes');
    });
  });

  describe('evaluate — result includes reason string', () => {
    it('returns a non-empty reason string', () => {
      const trigger = makeTriggerNode('order_completed', {});
      const result = service.evaluate(makeConditionNode(), trigger, makeContact(), {});
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });
});
