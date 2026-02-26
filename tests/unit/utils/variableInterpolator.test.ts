/**
 * @fileoverview Unit tests for variable interpolation utility.
 */

import { describe, it, expect } from 'vitest';
import { interpolate, extractVariables, buildContext } from '@/utils/variableInterpolator.js';

describe('variableInterpolator', () => {
  describe('interpolate', () => {
    it('should replace simple variables', () => {
      const result = interpolate('Hello {{first_name}}!', { first_name: 'John' });
      expect(result).toBe('Hello John!');
    });

    it('should replace multiple variables', () => {
      const result = interpolate('{{first_name}} ordered from {{restaurant_name}}', {
        first_name: 'Jane',
        restaurant_name: 'Pizza Palace',
      });
      expect(result).toBe('Jane ordered from Pizza Palace');
    });

    it('should handle whitespace in variable tags', () => {
      const result = interpolate('Hello {{ first_name }}!', { first_name: 'John' });
      expect(result).toBe('Hello John!');
    });

    it('should replace unmatched variables with empty string', () => {
      const result = interpolate('Hello {{first_name}} {{unknown}}!', { first_name: 'John' });
      expect(result).toBe('Hello John !');
    });

    it('should replace null/undefined values with empty string', () => {
      const result = interpolate('Hello {{first_name}}!', { first_name: null });
      expect(result).toBe('Hello !');
    });

    it('should convert numbers to strings', () => {
      const result = interpolate('Total: ${{order_total}}', { order_total: 42.5 });
      expect(result).toBe('Total: $42.5');
    });

    it('should handle boolean values', () => {
      const result = interpolate('Opted in: {{opted_in}}', { opted_in: true });
      expect(result).toBe('Opted in: true');
    });

    it('should handle empty template', () => {
      const result = interpolate('', { first_name: 'John' });
      expect(result).toBe('');
    });

    it('should handle template with no variables', () => {
      const result = interpolate('No variables here', { first_name: 'John' });
      expect(result).toBe('No variables here');
    });
  });

  describe('extractVariables', () => {
    it('should extract all variable names', () => {
      const vars = extractVariables('Hello {{first_name}}, your order {{order_number}} is ready');
      expect(vars).toEqual(expect.arrayContaining(['first_name', 'order_number']));
      expect(vars).toHaveLength(2);
    });

    it('should return unique variable names', () => {
      const vars = extractVariables('{{name}} and {{name}} again');
      expect(vars).toEqual(['name']);
    });

    it('should return empty array for no variables', () => {
      const vars = extractVariables('No variables here');
      expect(vars).toEqual([]);
    });

    it('should handle whitespace in tags', () => {
      const vars = extractVariables('{{ first_name }} and {{last_name}}');
      expect(vars).toEqual(expect.arrayContaining(['first_name', 'last_name']));
    });
  });

  describe('buildContext', () => {
    it('should build context from contact data', () => {
      const ctx = buildContext(
        { firstName: 'John', lastName: 'Doe', email: 'john@example.com', totalOrders: 5 },
        { name: 'Pizza Palace' },
      );
      expect(ctx.first_name).toBe('John');
      expect(ctx.last_name).toBe('Doe');
      expect(ctx.email).toBe('john@example.com');
      expect(ctx.total_orders).toBe(5);
      expect(ctx.restaurant_name).toBe('Pizza Palace');
    });

    it('should include order data when provided', () => {
      const ctx = buildContext(
        { firstName: 'John' },
        { name: 'Pizza Palace' },
        { total: 25.99, orderNumber: 'ORD-001', orderType: 'delivery' },
      );
      expect(ctx.order_total).toBe(25.99);
      expect(ctx.order_number).toBe('ORD-001');
      expect(ctx.order_type).toBe('delivery');
    });

    it('should include extras when provided', () => {
      const ctx = buildContext(
        { firstName: 'John' },
        { name: 'Pizza Palace' },
        null,
        { review_link: 'https://example.com/review', promo_code: 'SAVE10' },
      );
      expect(ctx.review_link).toBe('https://example.com/review');
      expect(ctx.promo_code).toBe('SAVE10');
    });

    it('should include custom fields from contact', () => {
      const ctx = buildContext(
        { firstName: 'John', customFields: { birthday: '1990-01-15', favorite_item: 'Pizza' } },
        { name: 'Pizza Palace' },
      );
      expect(ctx.birthday).toBe('1990-01-15');
      expect(ctx.favorite_item).toBe('Pizza');
    });

    it('should handle phone object in contact', () => {
      const ctx = buildContext(
        { firstName: 'John', phone: { countryCode: '+1', number: '5551234567' } },
        { name: 'Pizza Palace' },
      );
      expect(ctx.phone).toBe('+15551234567');
    });
  });
});
