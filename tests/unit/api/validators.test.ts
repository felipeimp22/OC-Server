/**
 * @fileoverview Unit tests for Zod API validators.
 */

import { describe, it, expect } from 'vitest';
import {
  paginationQuery,
  idParam,
  createFlowBody,
  updateFlowBody,
  updateContactBody,
  applyTagsBody,
  createTemplateBody,
  updateTemplateBody,
  previewTemplateBody,
  createTagBody,
  updateTagBody,
  createCustomFieldBody,
  createCampaignBody,
} from '@/api/validators/index.js';

describe('validators', () => {
  describe('paginationQuery', () => {
    it('should accept valid pagination', () => {
      const result = paginationQuery.parse({ page: '2', limit: '10', order: 'asc' });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.order).toBe('asc');
    });

    it('should provide defaults', () => {
      const result = paginationQuery.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.order).toBe('desc');
    });

    it('should coerce string numbers', () => {
      const result = paginationQuery.parse({ page: '3', limit: '50' });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(50);
    });

    it('should reject page < 1', () => {
      expect(() => paginationQuery.parse({ page: '0' })).toThrow();
    });

    it('should reject limit > 100', () => {
      expect(() => paginationQuery.parse({ limit: '101' })).toThrow();
    });

    it('should reject invalid order', () => {
      expect(() => paginationQuery.parse({ order: 'random' })).toThrow();
    });
  });

  describe('idParam', () => {
    it('should accept valid id', () => {
      const result = idParam.parse({ id: '507f1f77bcf86cd799439011' });
      expect(result.id).toBe('507f1f77bcf86cd799439011');
    });

    it('should reject empty id', () => {
      expect(() => idParam.parse({ id: '' })).toThrow();
    });

    it('should reject missing id', () => {
      expect(() => idParam.parse({})).toThrow();
    });
  });

  describe('createFlowBody', () => {
    it('should accept minimal flow', () => {
      const result = createFlowBody.parse({ name: 'My Flow' });
      expect(result.name).toBe('My Flow');
      expect(result.nodes).toBeUndefined();
      expect(result.edges).toBeUndefined();
    });

    it('should accept flow with nodes', () => {
      const result = createFlowBody.parse({
        name: 'My Flow',
        nodes: [{
          id: 'node-1',
          type: 'trigger',
          subType: 'order_placed',
          config: { minValue: 10 },
        }],
      });
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes![0].label).toBe(''); // default
      expect(result.nodes![0].config).toEqual({ minValue: 10 });
    });

    it('should accept flow with edges', () => {
      const result = createFlowBody.parse({
        name: 'My Flow',
        edges: [{ sourceNodeId: 'n1', targetNodeId: 'n2' }],
      });
      expect(result.edges).toHaveLength(1);
    });

    it('should reject empty name', () => {
      expect(() => createFlowBody.parse({ name: '' })).toThrow();
    });

    it('should reject name over 200 chars', () => {
      expect(() => createFlowBody.parse({ name: 'a'.repeat(201) })).toThrow();
    });

    it('should reject invalid node type', () => {
      expect(() => createFlowBody.parse({
        name: 'Test',
        nodes: [{ id: 'n1', type: 'invalid', subType: 'test' }],
      })).toThrow();
    });

    it('should validate all node types', () => {
      const validTypes = ['trigger', 'action', 'condition', 'timer', 'logic'];
      for (const type of validTypes) {
        const result = createFlowBody.parse({
          name: 'Test',
          nodes: [{ id: 'n1', type, subType: 'test' }],
        });
        expect(result.nodes![0].type).toBe(type);
      }
    });
  });

  describe('updateFlowBody', () => {
    it('should accept partial updates', () => {
      const result = updateFlowBody.parse({ name: 'New Name' });
      expect(result.name).toBe('New Name');
    });

    it('should accept empty object', () => {
      const result = updateFlowBody.parse({});
      expect(result).toBeDefined();
    });
  });

  describe('updateContactBody', () => {
    it('should accept valid contact update', () => {
      const result = updateContactBody.parse({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      });
      expect(result.firstName).toBe('John');
    });

    it('should accept phone object', () => {
      const result = updateContactBody.parse({
        phone: { countryCode: '+1', number: '5551234567' },
      });
      expect(result.phone!.countryCode).toBe('+1');
    });

    it('should accept null phone', () => {
      const result = updateContactBody.parse({ phone: null });
      expect(result.phone).toBeNull();
    });

    it('should reject invalid email', () => {
      expect(() => updateContactBody.parse({ email: 'not-an-email' })).toThrow();
    });

    it('should accept boolean opt-in flags', () => {
      const result = updateContactBody.parse({
        smsOptIn: true,
        emailOptIn: false,
      });
      expect(result.smsOptIn).toBe(true);
      expect(result.emailOptIn).toBe(false);
    });
  });

  describe('applyTagsBody', () => {
    it('should accept valid tag ids', () => {
      const result = applyTagsBody.parse({ tagIds: ['abc', 'def'] });
      expect(result.tagIds).toEqual(['abc', 'def']);
    });

    it('should reject empty array', () => {
      expect(() => applyTagsBody.parse({ tagIds: [] })).toThrow();
    });

    it('should reject empty string tag ids', () => {
      expect(() => applyTagsBody.parse({ tagIds: [''] })).toThrow();
    });
  });

  describe('createTemplateBody', () => {
    it('should accept email template', () => {
      const result = createTemplateBody.parse({
        channel: 'email',
        name: 'Welcome Email',
        subject: 'Welcome!',
        body: '<p>Hello {{first_name}}</p>',
      });
      expect(result.channel).toBe('email');
    });

    it('should accept sms template', () => {
      const result = createTemplateBody.parse({
        channel: 'sms',
        name: 'Order Follow-up',
        body: 'Thanks for your order, {{first_name}}!',
      });
      expect(result.channel).toBe('sms');
    });

    it('should reject invalid channel', () => {
      expect(() => createTemplateBody.parse({
        channel: 'push',
        name: 'Test',
        body: 'Hello',
      })).toThrow();
    });

    it('should reject empty body', () => {
      expect(() => createTemplateBody.parse({
        channel: 'sms',
        name: 'Test',
        body: '',
      })).toThrow();
    });
  });

  describe('createTagBody', () => {
    it('should accept valid tag', () => {
      const result = createTagBody.parse({ name: 'VIP' });
      expect(result.name).toBe('VIP');
    });

    it('should accept tag with color', () => {
      const result = createTagBody.parse({ name: 'VIP', color: '#FF5733' });
      expect(result.color).toBe('#FF5733');
    });

    it('should reject empty name', () => {
      expect(() => createTagBody.parse({ name: '' })).toThrow();
    });

    it('should reject name over 100 chars', () => {
      expect(() => createTagBody.parse({ name: 'a'.repeat(101) })).toThrow();
    });

    it('should reject invalid color format', () => {
      expect(() => createTagBody.parse({ name: 'VIP', color: 'red' })).toThrow();
      expect(() => createTagBody.parse({ name: 'VIP', color: '#GGG' })).toThrow();
    });
  });

  describe('createCustomFieldBody', () => {
    it('should accept valid custom field', () => {
      const result = createCustomFieldBody.parse({
        key: 'favorite_item',
        name: 'Favorite Item',
        fieldType: 'text',
      });
      expect(result.key).toBe('favorite_item');
      expect(result.isRequired).toBe(false); // default
      expect(result.sortOrder).toBe(0); // default
    });

    it('should validate key format (lowercase snake_case)', () => {
      expect(() => createCustomFieldBody.parse({
        key: 'Invalid Key',
        name: 'Test',
        fieldType: 'text',
      })).toThrow();
    });

    it('should accept all valid field types', () => {
      const types = ['text', 'number', 'date', 'dropdown', 'checkbox'] as const;
      for (const fieldType of types) {
        const result = createCustomFieldBody.parse({
          key: 'test',
          name: 'Test',
          fieldType,
        });
        expect(result.fieldType).toBe(fieldType);
      }
    });

    it('should reject invalid field type', () => {
      expect(() => createCustomFieldBody.parse({
        key: 'test',
        name: 'Test',
        fieldType: 'json',
      })).toThrow();
    });

    it('should accept options for dropdown fields', () => {
      const result = createCustomFieldBody.parse({
        key: 'status',
        name: 'Status',
        fieldType: 'dropdown',
        options: ['active', 'inactive'],
      });
      expect(result.options).toEqual(['active', 'inactive']);
    });
  });

  describe('createCampaignBody', () => {
    it('should accept valid campaign', () => {
      const result = createCampaignBody.parse({
        name: 'Summer Campaign',
        description: 'A summer promotion',
      });
      expect(result.name).toBe('Summer Campaign');
    });

    it('should reject empty name', () => {
      expect(() => createCampaignBody.parse({ name: '' })).toThrow();
    });

    it('should accept flowIds', () => {
      const result = createCampaignBody.parse({
        name: 'Test',
        flowIds: ['flow-1', 'flow-2'],
      });
      expect(result.flowIds).toEqual(['flow-1', 'flow-2']);
    });
  });
});
