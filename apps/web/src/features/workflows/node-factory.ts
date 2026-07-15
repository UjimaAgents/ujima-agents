"use client";

import type { WorkflowNode, WorkflowNodeKind } from "@ujima/shared";

const ID_PREFIX: Record<WorkflowNodeKind, string> = {
  trigger: "trigger",
  agent: "agent",
  approval: "approval",
  goal_handoff: "goal",
  skill: "skill",
  tool: "tool",
  output: "output",
};

/** Compute a short, readable, unique id like `agent-2` for token references. */
export function uniqueNodeId(kind: WorkflowNodeKind, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds);
  const prefix = ID_PREFIX[kind];
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 && kind === "trigger" ? prefix : `${prefix}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function createNode(
  kind: WorkflowNodeKind,
  position: { x: number; y: number },
  existingIds: Iterable<string>,
): WorkflowNode {
  const id = uniqueNodeId(kind, existingIds);
  const base = { id, position };
  switch (kind) {
    case "trigger":
      return { ...base, kind, config: { source: "mention" } };
    case "agent":
      return { ...base, kind, config: { agentId: "", prompt: "", requiresApproval: false } };
    case "approval":
      return { ...base, kind, config: {} };
    case "goal_handoff":
      return { ...base, kind, config: { titleTemplate: "{{input}}", tasksFrom: "json" } };
    case "skill":
      return { ...base, kind, config: { skillName: "" } };
    case "tool":
      return { ...base, kind, config: { toolId: "" } };
    case "output":
      return { ...base, kind, config: { format: "markdown" } };
  }
}
