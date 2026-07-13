"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  Bot,
  Flag,
  Play,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { WorkflowNode, WorkflowNodeKind, WorkflowNodeRunStatus } from "@ujima/shared";

export type FlowNodeData = { node: WorkflowNode; status?: WorkflowNodeRunStatus };
export type FlowNode = Node<FlowNodeData, "workflow">;

export const NODE_STATUS_STYLES: Record<WorkflowNodeRunStatus, { label: string; ring: string; dot: string }> = {
  pending: { label: "Pending", ring: "ring-2 ring-zinc-300 dark:ring-zinc-600", dot: "bg-zinc-400" },
  running: { label: "Running", ring: "ring-2 ring-blue-400 dark:ring-blue-400/70", dot: "bg-blue-500 animate-pulse" },
  awaiting_approval: { label: "Awaiting approval", ring: "ring-2 ring-amber-400 dark:ring-amber-400/70", dot: "bg-amber-500" },
  completed: { label: "Completed", ring: "ring-2 ring-emerald-400 dark:ring-emerald-400/70", dot: "bg-emerald-500" },
  failed: { label: "Failed", ring: "ring-2 ring-red-400 dark:ring-red-400/70", dot: "bg-red-500" },
  skipped: { label: "Skipped", ring: "ring-2 ring-zinc-300 dark:ring-zinc-600", dot: "bg-zinc-400" },
};

interface KindStyle {
  icon: LucideIcon;
  label: string;
  /** ring/border + icon tint (light + dark) */
  accent: string;
  iconWrap: string;
}

export const NODE_KIND_STYLES: Record<WorkflowNodeKind, KindStyle> = {
  trigger: {
    icon: Play,
    label: "Trigger",
    accent: "border-zinc-300 dark:border-zinc-600",
    iconWrap: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  },
  agent: {
    icon: Bot,
    label: "Agent",
    accent: "border-purple-300 dark:border-purple-500/50",
    iconWrap: "bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300",
  },
  approval: {
    icon: ShieldCheck,
    label: "Approval",
    accent: "border-amber-300 dark:border-amber-500/50",
    iconWrap: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  },
  goal_handoff: {
    icon: Flag,
    label: "Goal handoff",
    accent: "border-emerald-300 dark:border-emerald-500/50",
    iconWrap: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  skill: {
    icon: Sparkles,
    label: "Skill",
    accent: "border-sky-300 dark:border-sky-500/50",
    iconWrap: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
  },
  tool: {
    icon: Wrench,
    label: "Tool",
    accent: "border-slate-300 dark:border-slate-500/50",
    iconWrap: "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300",
  },
};

/** Short one-line subtitle describing the node's config. */
export function nodeSubtitle(node: WorkflowNode): string {
  switch (node.kind) {
    case "agent":
      return node.config.agentId ? `@${node.config.agentId}` : "no agent set";
    case "skill":
      return node.config.skillName;
    case "tool":
      return node.config.toolId;
    case "goal_handoff":
      return "hands off to a goal";
    case "approval":
      return "human approval gate";
    case "trigger":
      return node.config.source;
  }
}

const handleClass =
  "!h-2.5 !w-2.5 !border-2 !border-white !bg-zinc-400 dark:!border-zinc-900 dark:!bg-zinc-500";

export function WorkflowFlowNode({ data, selected }: NodeProps<FlowNode>) {
  const { node, status } = data;
  const style = NODE_KIND_STYLES[node.kind];
  const statusStyle = status ? NODE_STATUS_STYLES[status] : null;
  const Icon = style.icon;
  const isSub = node.kind === "skill" || node.kind === "tool";
  const title = node.label?.trim() || style.label;

  return (
    <div
      className={[
        "relative min-w-40 max-w-56 rounded-xl border bg-white px-3 py-2 shadow-sm transition dark:bg-zinc-900",
        style.accent,
        statusStyle ? statusStyle.ring : selected ? "ring-2 ring-purple-400/70 dark:ring-purple-400/60" : "",
        isSub ? "border-dashed" : "",
      ].join(" ")}
    >
      {statusStyle && (
        <span
          className={`absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full border-2 border-white dark:border-zinc-900 ${statusStyle.dot}`}
          title={statusStyle.label}
        />
      )}
      {/* main flow: sub-nodes don't accept a top (main) input */}
      {!isSub && node.kind !== "trigger" && (
        <Handle type="target" position={Position.Top} className={handleClass} />
      )}
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${style.iconWrap}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </div>
          <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {nodeSubtitle(node)}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className={handleClass} />
    </div>
  );
}

export const workflowNodeTypes = { workflow: WorkflowFlowNode };
