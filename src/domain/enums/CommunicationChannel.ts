/**
 * @fileoverview Communication channel enum.
 * Defines the delivery channels supported by the CRM engine.
 *
 * @module domain/enums/CommunicationChannel
 */

/** Supported communication channels */
export const CommunicationChannel = {
  /** Email delivery */
  EMAIL: 'email',
  /** SMS delivery */
  SMS: 'sms',
  /** Push notification (future) */
  PUSH: 'push',
} as const;

/** Union type of all communication channel values */
export type CommunicationChannel = (typeof CommunicationChannel)[keyof typeof CommunicationChannel];

/** Array of all communication channels for iteration / validation */
export const COMMUNICATION_CHANNELS: readonly CommunicationChannel[] = Object.values(CommunicationChannel);
