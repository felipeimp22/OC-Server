/**
 * @fileoverview Unit tests for domain enums.
 */

import { describe, it, expect } from 'vitest';
import {
  LifecycleStatus,
  LIFECYCLE_STATUSES,
  FlowStatus,
  FLOW_STATUSES,
  NodeType,
  NODE_TYPES,
  TriggerType,
  TRIGGER_TYPES,
  ActionType,
  ACTION_TYPES,
  LogicType,
  LOGIC_TYPES,
  CommunicationChannel,
  COMMUNICATION_CHANNELS,
} from '@/domain/enums/index.js';

describe('domain enums', () => {
  describe('LifecycleStatus', () => {
    it('should have all 6 statuses', () => {
      expect(LIFECYCLE_STATUSES).toHaveLength(6);
    });

    it('should contain expected values', () => {
      expect(LifecycleStatus.LEAD).toBe('lead');
      expect(LifecycleStatus.FIRST_TIME).toBe('first_time');
      expect(LifecycleStatus.RETURNING).toBe('returning');
      expect(LifecycleStatus.LOST).toBe('lost');
      expect(LifecycleStatus.RECOVERED).toBe('recovered');
      expect(LifecycleStatus.VIP).toBe('VIP');
    });

    it('LIFECYCLE_STATUSES array should match object values', () => {
      expect(LIFECYCLE_STATUSES).toEqual(Object.values(LifecycleStatus));
    });
  });

  describe('FlowStatus', () => {
    it('should have all 4 statuses', () => {
      expect(FLOW_STATUSES).toHaveLength(4);
    });

    it('should contain expected values', () => {
      expect(FlowStatus.DRAFT).toBe('draft');
      expect(FlowStatus.ACTIVE).toBe('active');
      expect(FlowStatus.PAUSED).toBe('paused');
      expect(FlowStatus.ARCHIVED).toBe('archived');
    });
  });

  describe('NodeType', () => {
    it('should have all 5 types', () => {
      expect(NODE_TYPES).toHaveLength(5);
    });

    it('should contain expected values', () => {
      expect(NodeType.TRIGGER).toBe('trigger');
      expect(NodeType.ACTION).toBe('action');
      expect(NodeType.CONDITION).toBe('condition');
      expect(NodeType.TIMER).toBe('timer');
      expect(NodeType.LOGIC).toBe('logic');
    });
  });

  describe('TriggerType', () => {
    it('should have 23 trigger types', () => {
      expect(TRIGGER_TYPES).toHaveLength(23);
    });

    it('should contain order triggers', () => {
      expect(TriggerType.ORDER_COMPLETED).toBe('order_completed');
      expect(TriggerType.FIRST_ORDER).toBe('first_order');
      expect(TriggerType.ABANDONED_CART).toBe('abandoned_cart');
    });

    it('should contain CRM triggers', () => {
      expect(TriggerType.TAG_APPLIED).toBe('tag_applied');
      expect(TriggerType.CONTACT_BIRTHDAY).toBe('contact_birthday');
      expect(TriggerType.FIELD_CHANGED).toBe('field_changed');
    });

    it('should contain activity triggers', () => {
      expect(TriggerType.LINK_CLICKED).toBe('link_clicked');
      expect(TriggerType.PAGE_VISITED).toBe('page_visited');
      expect(TriggerType.SMS_REPLY).toBe('sms_reply');
      expect(TriggerType.FORM_SUBMISSION).toBe('form_submission');
    });

    it('should contain developer triggers', () => {
      expect(TriggerType.WEBHOOK_INCOMING).toBe('webhook_incoming');
    });
  });

  describe('ActionType', () => {
    it('should have 11 action types', () => {
      expect(ACTION_TYPES).toHaveLength(11);
    });

    it('should contain communication actions', () => {
      expect(ActionType.SEND_EMAIL).toBe('send_email');
      expect(ActionType.SEND_SMS).toBe('send_sms');
      expect(ActionType.ADMIN_NOTIFICATION).toBe('admin_notification');
    });

    it('should contain CRM actions', () => {
      expect(ActionType.APPLY_TAG).toBe('apply_tag');
      expect(ActionType.REMOVE_TAG).toBe('remove_tag');
      expect(ActionType.UPDATE_FIELD).toBe('update_field');
      expect(ActionType.CREATE_TASK).toBe('create_task');
    });

    it('should contain advertising and developer actions', () => {
      expect(ActionType.META_CAPI).toBe('meta_capi_event');
      expect(ActionType.OUTGOING_WEBHOOK).toBe('outgoing_webhook');
    });
  });

  describe('LogicType', () => {
    it('should have 9 logic types', () => {
      expect(LOGIC_TYPES).toHaveLength(9);
    });

    it('should contain branching types', () => {
      expect(LogicType.YES_NO).toBe('yes_no');
      expect(LogicType.MULTI_BRANCH).toBe('multi_branch');
      expect(LogicType.AB_SPLIT).toBe('ab_split');
    });

    it('should contain control flow types', () => {
      expect(LogicType.LOOP).toBe('loop');
      expect(LogicType.STOP).toBe('stop');
      expect(LogicType.SKIP).toBe('skip');
      expect(LogicType.UNTIL_CONDITION).toBe('until_condition');
    });

    it('should contain smart date sequence', () => {
      expect(LogicType.SMART_DATE_SEQUENCE).toBe('smart_date_sequence');
    });
  });

  describe('CommunicationChannel', () => {
    it('should have all 3 channels', () => {
      expect(COMMUNICATION_CHANNELS).toHaveLength(3);
    });

    it('should contain expected values', () => {
      expect(CommunicationChannel.EMAIL).toBe('email');
      expect(CommunicationChannel.SMS).toBe('sms');
      expect(CommunicationChannel.PUSH).toBe('push');
    });
  });
});
