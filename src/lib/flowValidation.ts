/**
 * @fileoverview Server-side flow graph validation.
 * Enforces the 11 structural rules for CRM automation flows.
 *
 * @module lib/flowValidation
 */

import type { IFlowNode, IFlowEdge } from '../domain/models/crm/Flow.js';

export type ValidationResult =
  | { valid: true }
  | { valid: false; rule: string; message: string };

/** Thrown when graph validation fails — carries rule + message for 422 responses. */
export class FlowValidationError extends Error {
  constructor(
    public readonly rule: string,
    message: string,
  ) {
    super(message);
    this.name = 'FlowValidationError';
  }
}

/**
 * Validate a flow graph against the 11 structural rules.
 */
export function validateFlowGraph(
  nodes: IFlowNode[],
  edges: IFlowEdge[],
): ValidationResult {
  // Build adjacency helpers
  const nodeById = new Map<string, IFlowNode>(nodes.map((n) => [n.id, n]));
  // outgoing edges per node
  const outEdges = new Map<string, IFlowEdge[]>();
  // incoming edges per node
  const inEdges = new Map<string, IFlowEdge[]>();

  for (const node of nodes) {
    outEdges.set(node.id, []);
    inEdges.set(node.id, []);
  }
  for (const edge of edges) {
    outEdges.get(edge.sourceNodeId)?.push(edge);
    inEdges.get(edge.targetNodeId)?.push(edge);
  }

  // ── R-1: Exactly one trigger node ─────────────────────────────────
  const triggerNodes = nodes.filter((n) => n.type === 'trigger');
  if (triggerNodes.length === 0) {
    return { valid: false, rule: 'R-1', message: 'Flow must have exactly one trigger node (none found).' };
  }
  if (triggerNodes.length > 1) {
    return { valid: false, rule: 'R-1', message: 'Flow must have exactly one trigger node (multiple found).' };
  }
  const triggerNode = triggerNodes[0]!;

  // ── R-5: No cycles (DFS) ───────────────────────────────────────────
  const cycleResult = detectCycle(nodes, outEdges);
  if (cycleResult) {
    return { valid: false, rule: 'R-5', message: 'Flow contains a cycle, which is not allowed.' };
  }

  // ── R-4: Action nodes MAY have outgoing edges (action chaining/fan-out).
  // Action nodes with zero outgoing edges are still valid (terminal).
  // No validation needed — outgoing edges from actions are allowed.

  // ── R-7: Timer has exactly one incoming and one outgoing edge ──────
  for (const node of nodes) {
    if (node.type === 'timer') {
      const out = outEdges.get(node.id) ?? [];
      const inc = inEdges.get(node.id) ?? [];
      if (inc.length !== 1) {
        return {
          valid: false,
          rule: 'R-7',
          message: `Timer node "${node.label || node.id}" must have exactly one incoming edge (found ${inc.length}).`,
        };
      }
      if (out.length !== 1) {
        return {
          valid: false,
          rule: 'R-7',
          message: `Timer node "${node.label || node.id}" must have exactly one outgoing edge (found ${out.length}).`,
        };
      }
    }
  }

  // ── R-6: yes_no condition has exactly 2 outgoing edges (yes + no) ──
  // Both branches must eventually terminate in an action node (may pass through timers or other actions first)
  for (const node of nodes) {
    if (node.type === 'condition' && node.subType === 'yes_no') {
      const out = outEdges.get(node.id) ?? [];
      if (out.length !== 2) {
        return {
          valid: false,
          rule: 'R-6',
          message: `Yes/No condition "${node.label || node.id}" must have exactly 2 outgoing edges (found ${out.length}).`,
        };
      }
      // Check handles
      const handles = out.map((e) => e.sourceHandle);
      if (!handles.includes('yes') || !handles.includes('no')) {
        return {
          valid: false,
          rule: 'R-6',
          message: `Yes/No condition "${node.label || node.id}" must have "yes" and "no" outgoing handles.`,
        };
      }
      // Validate each branch: DFS to verify every leaf node is an action
      for (const edge of out) {
        const target = nodeById.get(edge.targetNodeId);
        if (!target) continue;
        const branchResult = validateConditionBranch(target, nodeById, outEdges);
        if (!branchResult.valid) {
          return branchResult;
        }
      }
    }
  }

  // ── R-2: yes_no condition as direct child of trigger OR action node ─
  const triggerChildren = new Set(
    (outEdges.get(triggerNode.id) ?? []).map((e) => e.targetNodeId),
  );
  const actionChildren = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'action') {
      for (const edge of outEdges.get(node.id) ?? []) {
        actionChildren.add(edge.targetNodeId);
      }
    }
  }
  for (const node of nodes) {
    if (node.type === 'condition' && node.subType === 'yes_no') {
      if (!triggerChildren.has(node.id) && !actionChildren.has(node.id)) {
        return {
          valid: false,
          rule: 'R-2',
          message: `Yes/No condition "${node.label || node.id}" must be a direct child of the trigger node or an action node.`,
        };
      }
    }
  }

  // ── R-3: Timer cannot appear as direct child of trigger ─────────────
  for (const childId of triggerChildren) {
    const child = nodeById.get(childId);
    if (child?.type === 'timer') {
      return {
        valid: false,
        rule: 'R-3',
        message: `Timer node "${child.label || child.id}" cannot appear as a direct child of the trigger node.`,
      };
    }
  }

  // ── R-8: No back-to-back conditions ────────────────────────────────
  for (const node of nodes) {
    if (node.type === 'condition') {
      const out = outEdges.get(node.id) ?? [];
      for (const edge of out) {
        const target = nodeById.get(edge.targetNodeId);
        if (target?.type === 'condition') {
          return {
            valid: false,
            rule: 'R-8',
            message: `Condition "${node.label || node.id}" cannot be directly followed by another condition.`,
          };
        }
      }
    }
  }

  // ── R-9: Max depth 10 nodes ─────────────────────────────────────────
  const maxDepth = computeMaxDepth(triggerNode.id, outEdges);
  if (maxDepth > 10) {
    return {
      valid: false,
      rule: 'R-9',
      message: `Flow exceeds maximum depth of 10 nodes (current depth: ${maxDepth}).`,
    };
  }

  // ── R-10: All non-trigger nodes must be reachable from trigger ──────
  if (nodes.length > 1) {
    const reachable = new Set<string>();
    const queue = [triggerNode.id];
    reachable.add(triggerNode.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of outEdges.get(current) ?? []) {
        if (!reachable.has(edge.targetNodeId)) {
          reachable.add(edge.targetNodeId);
          queue.push(edge.targetNodeId);
        }
      }
    }
    const orphanNodes = nodes.filter((n) => !reachable.has(n.id));
    if (orphanNodes.length > 0) {
      const orphanLabels = orphanNodes
        .map((n) => n.label || n.subType || n.id)
        .join(', ');
      return {
        valid: false,
        rule: 'R-10',
        message: `Unconnected nodes found: ${orphanLabels}. All nodes must be connected to the trigger.`,
      };
    }
  }

  // ── R-11: Fan-out constraint — max 10 outgoing edges per node ──────
  for (const node of nodes) {
    const out = outEdges.get(node.id) ?? [];
    if (out.length > 10) {
      return {
        valid: false,
        rule: 'R-11',
        message: `Node "${node.label || node.id}" has ${out.length} outgoing edges, exceeding the maximum of 10.`,
      };
    }
  }

  // ── Semantic validation: R-12 through R-19 (node config completeness) ──

  for (const node of nodes) {
    const config = node.config ?? {};
    const label = node.label || node.id;

    // ── R-12: Email action must have at least one recipient ────────
    if (node.type === 'action' && node.subType === 'send_email') {
      const recipients = config.recipients as unknown[] | undefined;
      if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return { valid: false, rule: 'R-12', message: `Email action "${label}" has no recipients configured` };
      }
    }

    // ── R-13: Email action must have a subject ─────────────────────
    if (node.type === 'action' && node.subType === 'send_email') {
      const subject = config.subject as string | undefined;
      if (!subject || (subject as string).trim() === '') {
        return { valid: false, rule: 'R-13', message: `Email action "${label}" has no subject` };
      }
    }

    // ── R-14: SMS action must have a body ──────────────────────────
    if (node.type === 'action' && node.subType === 'send_sms') {
      const body = config.body as string | undefined;
      if (!body || (body as string).trim() === '') {
        return { valid: false, rule: 'R-14', message: `SMS action "${label}" has no message body` };
      }
    }

    // ── R-15: SMS custom recipient must have a phone number ────────
    if (node.type === 'action' && node.subType === 'send_sms') {
      const recipient = config.recipient as { type?: string; phone?: string } | undefined;
      if (recipient?.type === 'custom' && (!recipient.phone || recipient.phone.trim() === '')) {
        return { valid: false, rule: 'R-15', message: `SMS action "${label}" has custom recipient with no phone number` };
      }
    }

    // ── R-16: Webhook action must have a valid URL ─────────────────
    if (node.type === 'action' && node.subType === 'outgoing_webhook') {
      const url = config.url as string | undefined;
      if (!url || (url as string).trim() === '' || (!(url as string).startsWith('http://') && !(url as string).startsWith('https://'))) {
        return { valid: false, rule: 'R-16', message: `Webhook action "${label}" has no URL or invalid URL` };
      }
    }

    // ── R-17: Item trigger must have at least one item ─────────────
    if (node.type === 'trigger' && (node.subType === 'item_ordered' || node.subType === 'item_ordered_x_times')) {
      const items = config.items as unknown[] | undefined;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return { valid: false, rule: 'R-17', message: `Item trigger "${label}" has no menu items configured` };
      }
    }

    // ── R-18: Timer delay must have a duration ─────────────────────
    if (node.type === 'timer' && node.subType === 'delay') {
      const duration = config.duration as number | undefined;
      if (!duration || typeof duration !== 'number' || duration <= 0) {
        return { valid: false, rule: 'R-18', message: `Timer "${label}" has no delay duration set` };
      }
    }

    // ── R-19: Timer date_field must have a target date ─────────────
    if (node.type === 'timer' && node.subType === 'date_field') {
      const targetDateUtc = config.targetDateUtc as string | undefined;
      if (!targetDateUtc || (targetDateUtc as string).trim() === '') {
        return { valid: false, rule: 'R-19', message: `Timer "${label}" has no target date set` };
      }
    }
  }

  return { valid: true };
}

/**
 * Validate a branch from a yes_no condition using DFS.
 * Every leaf node (no outgoing edges) must be an action node.
 * Branches may pass through timers, other actions, or other conditions first.
 */
function validateConditionBranch(
  startNode: IFlowNode,
  nodeById: Map<string, IFlowNode>,
  outEdges: Map<string, IFlowEdge[]>,
): ValidationResult {
  // DFS: follow all paths from startNode. Every leaf (node with no outgoing edges) must be an action.
  const visited = new Set<string>();

  function dfs(node: IFlowNode): ValidationResult {
    if (visited.has(node.id)) return { valid: true }; // cycles caught by R-5
    visited.add(node.id);

    const out = outEdges.get(node.id) ?? [];

    if (out.length === 0) {
      // Leaf node — must be an action
      if (node.type !== 'action') {
        return {
          valid: false,
          rule: 'R-6',
          message: `Condition branch must eventually terminate in an action node, but found terminal ${node.type} node "${node.label || node.id}".`,
        };
      }
      return { valid: true };
    }

    // Non-leaf: follow all outgoing edges
    for (const edge of out) {
      const target = nodeById.get(edge.targetNodeId);
      if (!target) continue;
      const result = dfs(target);
      if (!result.valid) return result;
    }
    return { valid: true };
  }

  return dfs(startNode);
}

/**
 * Detect cycles using DFS coloring (white=0, gray=1, black=2).
 * Returns true if a cycle is found.
 */
function detectCycle(
  nodes: IFlowNode[],
  outEdges: Map<string, IFlowEdge[]>,
): boolean {
  const color = new Map<string, number>();
  for (const node of nodes) color.set(node.id, 0);

  function dfs(nodeId: string): boolean {
    color.set(nodeId, 1); // gray — in stack
    for (const edge of outEdges.get(nodeId) ?? []) {
      const c = color.get(edge.targetNodeId) ?? 0;
      if (c === 1) return true; // back edge — cycle
      if (c === 0 && dfs(edge.targetNodeId)) return true;
    }
    color.set(nodeId, 2); // black — done
    return false;
  }

  for (const node of nodes) {
    if ((color.get(node.id) ?? 0) === 0) {
      if (dfs(node.id)) return true;
    }
  }
  return false;
}

/**
 * Compute the maximum path depth from the start node (counting nodes, not edges).
 */
function computeMaxDepth(
  startId: string,
  outEdges: Map<string, IFlowEdge[]>,
): number {
  let max = 0;

  function dfs(nodeId: string, depth: number): void {
    if (depth > max) max = depth;
    for (const edge of outEdges.get(nodeId) ?? []) {
      dfs(edge.targetNodeId, depth + 1);
    }
  }

  dfs(startId, 1);
  return max;
}
