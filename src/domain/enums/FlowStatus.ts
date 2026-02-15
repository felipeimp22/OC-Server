/**
 * @fileoverview Flow status enum for automation flows.
 * Controls whether a flow is actively processing new enrollments.
 *
 * @module domain/enums/FlowStatus
 */

/** All possible statuses for an automation flow */
export const FlowStatus = {
  /** Flow is being designed, not processing events */
  DRAFT: 'draft',
  /** Flow is live and processing new enrollments */
  ACTIVE: 'active',
  /** Flow is paused — existing executions continue, no new enrollments */
  PAUSED: 'paused',
  /** Flow is archived and hidden from active list */
  ARCHIVED: 'archived',
} as const;

/** Union type of all flow status values */
export type FlowStatus = (typeof FlowStatus)[keyof typeof FlowStatus];

/** Array of all flow statuses for iteration / validation */
export const FLOW_STATUSES: readonly FlowStatus[] = Object.values(FlowStatus);
