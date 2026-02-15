/**
 * @fileoverview Logic type enum — control flow logic subtypes.
 * Logic nodes change the execution path without performing external actions.
 *
 * @module domain/enums/LogicType
 */

/** All logic subtypes for flow logic / condition nodes */
export const LogicType = {
  /** Binary branching: evaluates a condition → yes or no path */
  YES_NO: 'yes_no',
  /** Multi-branch: evaluates multiple conditions, follows first match */
  MULTI_BRANCH: 'multi_branch',
  /** A/B split: random distribution by configured percentages */
  AB_SPLIT: 'ab_split',
  /** Random distribution across N branches */
  RANDOM_DISTRIBUTION: 'random_distribution',
  /** Repeat a set of steps up to maxIterations */
  LOOP: 'loop',
  /** Skip the next step and continue */
  SKIP: 'skip',
  /** End the flow execution for this contact */
  STOP: 'stop',
  /** Loop until a condition is met, then advance */
  UNTIL_CONDITION: 'until_condition',
  /** Smart date sequence — schedule steps relative to dates with weekday/time rules */
  SMART_DATE_SEQUENCE: 'smart_date_sequence',
} as const;

/** Union type of all logic type values */
export type LogicType = (typeof LogicType)[keyof typeof LogicType];

/** Array of all logic types for iteration / validation */
export const LOGIC_TYPES: readonly LogicType[] = Object.values(LogicType);
