/**
 * @fileoverview Seed script — creates default flow templates and system flows.
 *
 * Run: npx tsx src/seeds/seed.ts
 *
 * Idempotent — only creates records that don't already exist.
 *
 * @module seeds/seed
 */

import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { FlowService } from '../services/FlowService.js';
import { TemplateService } from '../services/TemplateService.js';
import { TagRepository } from '../repositories/TagRepository.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('Seed');

// ── System Review Request Flow Definition ──

const SYSTEM_REVIEW_FLOW = {
  name: 'Post-Order Review Request',
  description: 'System-owned flow that sends review requests after completed orders.',
  isSystem: true,
  nodes: [
    {
      id: 'trigger_1',
      type: 'trigger' as const,
      subType: 'order_completed',
      config: { orderTypes: ['delivery', 'pickup', 'dine_in'] },
    },
    {
      id: 'timer_1',
      type: 'timer' as const,
      subType: 'delay',
      config: { duration: 45, unit: 'minutes' },
    },
    {
      id: 'condition_1',
      type: 'condition' as const,
      subType: 'yes_no',
      config: { field: 'smsOptIn', operator: 'eq', value: true },
    },
    {
      id: 'action_sms',
      type: 'action' as const,
      subType: 'send_sms',
      config: {
        templateId: 'system_review_sms',
        body: "Hey {{first_name}} 👋 Thanks for ordering from {{restaurant_name}}! If you enjoyed your meal, we'd really appreciate a quick review: {{review_link}}",
      },
    },
    {
      id: 'condition_2',
      type: 'condition' as const,
      subType: 'yes_no',
      config: { field: 'emailOptIn', operator: 'eq', value: true },
    },
    {
      id: 'action_email',
      type: 'action' as const,
      subType: 'send_email',
      config: {
        templateId: 'system_review_email',
        subject: 'How was your order from {{restaurant_name}}?',
      },
    },
    {
      id: 'stop_1',
      type: 'logic' as const,
      subType: 'stop',
      config: {},
    },
  ],
  edges: [
    { sourceNodeId: 'trigger_1', targetNodeId: 'timer_1' },
    { sourceNodeId: 'timer_1', targetNodeId: 'condition_1' },
    { sourceNodeId: 'condition_1', targetNodeId: 'action_sms', sourceHandle: 'yes' },
    { sourceNodeId: 'condition_1', targetNodeId: 'condition_2', sourceHandle: 'no' },
    { sourceNodeId: 'action_sms', targetNodeId: 'stop_1' },
    { sourceNodeId: 'condition_2', targetNodeId: 'action_email', sourceHandle: 'yes' },
    { sourceNodeId: 'condition_2', targetNodeId: 'stop_1', sourceHandle: 'no' },
    { sourceNodeId: 'action_email', targetNodeId: 'stop_1' },
  ],
};

// ── Default Flow Templates ──

export const FLOW_TEMPLATES = [
  {
    name: 'Post-Order Nurture',
    description: 'Thank customers after an order, then encourage repeat business 7 days later.',
    nodes: [
      { id: 't1', type: 'trigger', subType: 'order_completed', config: {} },
      { id: 'd1', type: 'timer', subType: 'delay', config: { duration: 24, unit: 'hours' } },
      { id: 'a1', type: 'action', subType: 'send_email', config: { subject: 'Thank you for your order, {{first_name}}!', body: 'We hope you enjoyed your meal from {{restaurant_name}}. See you again soon!' } },
      { id: 'd2', type: 'timer', subType: 'delay', config: { duration: 7, unit: 'days' } },
      { id: 'a2', type: 'action', subType: 'send_email', config: { subject: "Ready for another order, {{first_name}}?", body: "It's been a week since your last order from {{restaurant_name}}. Order again today!" } },
      { id: 's1', type: 'logic', subType: 'stop', config: {} },
    ],
    edges: [
      { sourceNodeId: 't1', targetNodeId: 'd1' },
      { sourceNodeId: 'd1', targetNodeId: 'a1' },
      { sourceNodeId: 'a1', targetNodeId: 'd2' },
      { sourceNodeId: 'd2', targetNodeId: 'a2' },
      { sourceNodeId: 'a2', targetNodeId: 's1' },
    ],
  },
  {
    name: 'Abandoned Cart Recovery',
    description: 'Recover abandoned carts with email reminders.',
    nodes: [
      { id: 't1', type: 'trigger', subType: 'cart_abandoned', config: {} },
      { id: 'd1', type: 'timer', subType: 'delay', config: { duration: 1, unit: 'hours' } },
      { id: 'a1', type: 'action', subType: 'send_email', config: { subject: 'You left something behind!', body: "Hi {{first_name}}, you still have items in your cart at {{restaurant_name}}. Complete your order now!" } },
      { id: 'd2', type: 'timer', subType: 'delay', config: { duration: 24, unit: 'hours' } },
      { id: 'c1', type: 'condition', subType: 'yes_no', config: { field: 'totalOrders', operator: 'gt', value: 0 } },
      { id: 'a2', type: 'action', subType: 'send_email', config: { subject: 'Last chance — your cart is waiting!', body: "Hi {{first_name}}, don't miss out on your favorites from {{restaurant_name}}!" } },
      { id: 's1', type: 'logic', subType: 'stop', config: {} },
    ],
    edges: [
      { sourceNodeId: 't1', targetNodeId: 'd1' },
      { sourceNodeId: 'd1', targetNodeId: 'a1' },
      { sourceNodeId: 'a1', targetNodeId: 'd2' },
      { sourceNodeId: 'd2', targetNodeId: 'c1' },
      { sourceNodeId: 'c1', targetNodeId: 's1', sourceHandle: 'yes' },
      { sourceNodeId: 'c1', targetNodeId: 'a2', sourceHandle: 'no' },
      { sourceNodeId: 'a2', targetNodeId: 's1' },
    ],
  },
  {
    name: '45-Day Reactivation',
    description: 'Re-engage customers who haven\'t ordered in 45 days.',
    nodes: [
      { id: 't1', type: 'trigger', subType: 'no_order_in_x_days', config: { days: 45 } },
      { id: 'a1', type: 'action', subType: 'send_email', config: { subject: 'We miss you, {{first_name}}!', body: "It's been a while since your last order from {{restaurant_name}}. Come back and enjoy a special offer!" } },
      { id: 'd1', type: 'timer', subType: 'delay', config: { duration: 7, unit: 'days' } },
      { id: 'c1', type: 'condition', subType: 'yes_no', config: { field: 'totalOrders', operator: 'gt', value: 0 } },
      { id: 'a2', type: 'action', subType: 'apply_tag', config: { tagId: 'recovered' } },
      { id: 'a3', type: 'action', subType: 'apply_tag', config: { tagId: 'lost' } },
      { id: 's1', type: 'logic', subType: 'stop', config: {} },
    ],
    edges: [
      { sourceNodeId: 't1', targetNodeId: 'a1' },
      { sourceNodeId: 'a1', targetNodeId: 'd1' },
      { sourceNodeId: 'd1', targetNodeId: 'c1' },
      { sourceNodeId: 'c1', targetNodeId: 'a2', sourceHandle: 'yes' },
      { sourceNodeId: 'c1', targetNodeId: 'a3', sourceHandle: 'no' },
      { sourceNodeId: 'a2', targetNodeId: 's1' },
      { sourceNodeId: 'a3', targetNodeId: 's1' },
    ],
  },
  {
    name: 'Lost Customer Tagging',
    description: 'Automatically tag customers as lost after 60 days of inactivity.',
    nodes: [
      { id: 't1', type: 'trigger', subType: 'no_order_in_x_days', config: { days: 60 } },
      { id: 'a1', type: 'action', subType: 'apply_tag', config: { tagId: 'lost' } },
      { id: 'a2', type: 'action', subType: 'update_field', config: { fieldKey: 'lifecycleStatus', value: 'lost' } },
      { id: 's1', type: 'logic', subType: 'stop', config: {} },
    ],
    edges: [
      { sourceNodeId: 't1', targetNodeId: 'a1' },
      { sourceNodeId: 'a1', targetNodeId: 'a2' },
      { sourceNodeId: 'a2', targetNodeId: 's1' },
    ],
  },
  {
    name: 'Recovered Customer Flow',
    description: 'Welcome back customers who were previously lost.',
    nodes: [
      { id: 't1', type: 'trigger', subType: 'tag_applied', config: { tagId: 'recovered' } },
      { id: 'a1', type: 'action', subType: 'send_email', config: { subject: 'Welcome back, {{first_name}}!', body: "We're so happy to see you again at {{restaurant_name}}!" } },
      { id: 'a2', type: 'action', subType: 'remove_tag', config: { tagId: 'lost' } },
      { id: 's1', type: 'logic', subType: 'stop', config: {} },
    ],
    edges: [
      { sourceNodeId: 't1', targetNodeId: 'a1' },
      { sourceNodeId: 'a1', targetNodeId: 'a2' },
      { sourceNodeId: 'a2', targetNodeId: 's1' },
    ],
  },
  {
    name: 'VIP Milestone',
    description: 'Celebrate when a customer reaches VIP status (10 orders).',
    nodes: [
      { id: 't1', type: 'trigger', subType: 'order_completed', config: {} },
      { id: 'c1', type: 'condition', subType: 'yes_no', config: { field: 'totalOrders', operator: 'eq', value: 10 } },
      { id: 'a1', type: 'action', subType: 'apply_tag', config: { tagId: 'VIP' } },
      { id: 'a2', type: 'action', subType: 'send_email', config: { subject: "You're a VIP now, {{first_name}}! 🎉", body: "10 orders and counting! Thank you for being a loyal customer of {{restaurant_name}}." } },
      { id: 's1', type: 'logic', subType: 'stop', config: {} },
    ],
    edges: [
      { sourceNodeId: 't1', targetNodeId: 'c1' },
      { sourceNodeId: 'c1', targetNodeId: 'a1', sourceHandle: 'yes' },
      { sourceNodeId: 'c1', targetNodeId: 's1', sourceHandle: 'no' },
      { sourceNodeId: 'a1', targetNodeId: 'a2' },
      { sourceNodeId: 'a2', targetNodeId: 's1' },
    ],
  },
  {
    name: 'Birthday Offer',
    description: 'Send a birthday greeting with a special offer.',
    nodes: [
      { id: 't1', type: 'trigger', subType: 'date_field', config: { dateField: 'birthday' } },
      { id: 'a1', type: 'action', subType: 'send_email', config: { subject: 'Happy Birthday, {{first_name}}! 🎂', body: "Celebrate your special day with a treat from {{restaurant_name}}!" } },
      { id: 's1', type: 'logic', subType: 'stop', config: {} },
    ],
    edges: [
      { sourceNodeId: 't1', targetNodeId: 'a1' },
      { sourceNodeId: 'a1', targetNodeId: 's1' },
    ],
  },
];

// ── System Tags ──

const SYSTEM_TAGS = [
  { name: 'VIP', color: '#FFD700', isSystem: true },
  { name: 'lost', color: '#DC2626', isSystem: true },
  { name: 'recovered', color: '#16A34A', isSystem: true },
  { name: 'at-risk', color: '#F59E0B', isSystem: true },
];

// ── System Templates ──

const SYSTEM_TEMPLATES = [
  {
    channel: 'sms' as const,
    name: 'System Review SMS',
    body: "Hey {{first_name}} 👋 Thanks for ordering from {{restaurant_name}}! If you enjoyed your meal, we'd really appreciate a quick review: {{review_link}}",
    isSystem: true,
  },
  {
    channel: 'email' as const,
    name: 'System Review Email',
    subject: 'How was your order from {{restaurant_name}}?',
    body: '<p>Hi {{first_name}},</p><p>We hope you enjoyed your recent order from {{restaurant_name}}. Your feedback helps us improve and helps other customers find great food!</p><p><a href="{{review_link}}">Leave a quick review</a></p><p>Thank you!</p>',
    isSystem: true,
  },
];

// ── Main Seed Function ──

export async function seed(restaurantId: string): Promise<void> {
  const flowService = new FlowService();
  const templateService = new TemplateService();
  const tagRepo = new TagRepository();

  log.info({ restaurantId }, 'Seeding default data...');

  // Create system tags
  for (const tagData of SYSTEM_TAGS) {
    const existing = await tagRepo.findByName(restaurantId, tagData.name);
    if (!existing) {
      await tagRepo.create({ restaurantId, ...tagData, contactCount: 0 } as any);
      log.info({ tag: tagData.name }, 'System tag created');
    }
  }

  // Create system templates
  for (const tmpl of SYSTEM_TEMPLATES) {
    const existing = await templateService.list(restaurantId, { name: tmpl.name, isSystem: true });
    if (existing.total === 0) {
      await templateService.create(restaurantId, tmpl);
      log.info({ template: tmpl.name }, 'System template created');
    }
  }

  // Create system review flow
  const existingSystemFlow = await flowService.getSystemFlow(restaurantId);
  if (!existingSystemFlow) {
    const flow = await flowService.create(restaurantId, SYSTEM_REVIEW_FLOW as any);
    await flowService.activate(restaurantId, flow._id.toString());
    log.info('System review flow created and activated');
  }

  log.info({ restaurantId }, 'Seed complete');
}

// ── CLI Runner ──

if (process.argv[1]?.includes('seed')) {
  const restaurantId = process.argv[2];
  if (!restaurantId) {
    console.error('Usage: npx tsx src/seeds/seed.ts <restaurantId>');
    process.exit(1);
  }

  connectDatabase()
    .then(() => seed(restaurantId))
    .then(() => disconnectDatabase())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
