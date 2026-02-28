/**
 * @fileoverview Server-side flow graph validation.
 * Enforces the 9 structural rules for CRM automation flows.
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
 * Validate a flow graph against the 9 structural rules.
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

  // ── R-4: Action nodes have no outgoing edges ───────────────────────
  for (const node of nodes) {
    if (node.type === 'action') {
      const out = outEdges.get(node.id) ?? [];
      if (out.length > 0) {
        return {
          valid: false,
          rule: 'R-4',
          message: `Action node "${node.label || node.id}" must be terminal (no outgoing edges).`,
        };
      }
    }
  }

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
  // Both branches must terminate in an action node (optionally preceded by a timer)
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
      // Validate each branch: timer? → action
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

  // ── R-2: yes_no condition only at depth 1 from trigger ─────────────
  // Depth 1 = direct children of the trigger node
  const triggerChildren = new Set(
    (outEdges.get(triggerNode.id) ?? []).map((e) => e.targetNodeId),
  );
  for (const node of nodes) {
    if (node.type === 'condition' && node.subType === 'yes_no') {
      if (!triggerChildren.has(node.id)) {
        return {
          valid: false,
          rule: 'R-2',
          message: `Yes/No condition "${node.label || node.id}" must be a direct child of the trigger node.`,
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

  return { valid: true };
}

/**
 * Validate a branch from a yes_no condition: must be timer→action or directly action.
 */
function validateConditionBranch(
  node: IFlowNode,
  nodeById: Map<string, IFlowNode>,
  outEdges: Map<string, IFlowEdge[]>,
): ValidationResult {
  if (node.type === 'action') {
    return { valid: true };
  }
  if (node.type === 'timer') {
    // Timer must lead to exactly one action node
    const out = outEdges.get(node.id) ?? [];
    if (out.length !== 1) {
      return {
        valid: false,
        rule: 'R-6',
        message: `Timer "${node.label || node.id}" in condition branch must have exactly one outgoing edge.`,
      };
    }
    const next = nodeById.get(out[0]!.targetNodeId);
    if (!next || next.type !== 'action') {
      return {
        valid: false,
        rule: 'R-6',
        message: `Condition branch timer "${node.label || node.id}" must be followed by an action node.`,
      };
    }
    return { valid: true };
  }
  return {
    valid: false,
    rule: 'R-6',
    message: `Condition branch must terminate in an action node (optionally preceded by a timer), but found type "${node.type}".`,
  };
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
