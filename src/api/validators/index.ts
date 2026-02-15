/**
 * @fileoverview Zod validators for API request bodies and query strings.
 *
 * @module api/validators
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

// ── Common ──
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const idParam = z.object({
  id: z.string().min(1),
});

// ── Flows ──
export const createFlowBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  nodes: z.array(z.object({
    id: z.string(),
    type: z.enum(['trigger', 'action', 'condition', 'timer', 'logic']),
    subType: z.string(),
    label: z.string().default(''),
    config: z.record(z.unknown()).default({}),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  })).optional(),
  edges: z.array(z.object({
    id: z.string().default(() => uuidv4()),
    sourceNodeId: z.string(),
    targetNodeId: z.string(),
    sourceHandle: z.string().optional(),
    label: z.string().optional(),
  })).optional(),
});

export const updateFlowBody = createFlowBody.partial();

// ── Contacts ──
export const updateContactBody = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.object({
    countryCode: z.string(),
    number: z.string(),
  }).nullable().optional(),
  lifecycleStatus: z.string().optional(),
  customFields: z.record(z.unknown()).optional(),
  smsOptIn: z.boolean().optional(),
  emailOptIn: z.boolean().optional(),
});

export const applyTagsBody = z.object({
  tagIds: z.array(z.string().min(1)).min(1),
});

// ── Templates ──
export const createTemplateBody = z.object({
  channel: z.enum(['email', 'sms']),
  name: z.string().min(1).max(200),
  subject: z.string().max(500).optional(),
  body: z.string().min(1),
});

export const updateTemplateBody = createTemplateBody.partial();

export const previewTemplateBody = z.object({
  sampleData: z.record(z.unknown()),
});

// ── Tags ──
export const createTagBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const updateTagBody = createTagBody.partial();

// ── Custom Fields ──
export const createCustomFieldBody = z.object({
  key: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(100),
  fieldType: z.enum(['text', 'number', 'date', 'dropdown', 'checkbox']),
  options: z.array(z.string()).optional(),
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export const updateCustomFieldBody = createCustomFieldBody.partial();

// ── Campaigns ──
export const createCampaignBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  flowIds: z.array(z.string()).optional(),
  source: z.string().optional(),
});

export const updateCampaignBody = createCampaignBody.partial();
