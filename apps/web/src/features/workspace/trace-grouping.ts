import type { TraceStepData } from "./components/chat/trace-types";
import { diffStats } from "@ujima/shared/browser";

type AggregatedOperation = NonNullable<TraceStepData["aggregatedOperations"]>[number];

function parseLineRange(meta: string): string | undefined {
  const range = meta.match(/startLine=(\d+),\s*endLine=(\d+)/i);
  if (range) return `${range[1]}-${range[2]}`;
  const offset = meta.match(/offset=(\d+),\s*limit=(\d+)/i);
  if (offset) {
    const start = Number.parseInt(offset[1], 10);
    const limit = Number.parseInt(offset[2], 10);
    return `${start}-${start + limit - 1}`;
  }
  return undefined;
}

function toolStepToOperation(step: TraceStepData): AggregatedOperation {
  const base = {
    id: step.id,
    additions: 0,
    deletions: 0,
    status: step.status,
    toolInput: step.toolInput,
    toolResult: step.toolResult,
  };

  if (step.filesystem) {
    const isWrite = step.filesystem.action === "write";
    const isDelete = step.title.toLowerCase().includes("deleted");
    const body = step.filesystem.body || "";
    return {
      ...base,
      type: isDelete ? "delete" : isWrite ? "edit" : "read",
      file: step.filesystem.resourcePath,
      body,
      lines: step.filesystem.meta ? parseLineRange(step.filesystem.meta) : undefined,
      ...(isWrite || isDelete ? diffStats(body) : {}),
    };
  }
  if (step.grep) {
    return { ...base, type: "search", query: step.grep.query, file: step.grep.path };
  }
  if (step.webSearch) {
    return { ...base, type: "search", query: step.webSearch.query };
  }
  if (step.terminal) {
    return {
      ...base,
      type: "shell",
      command: step.terminal.commandLine,
      file: step.terminal.cwd,
      terminal: step.terminal,
    };
  }
  if (step.skillRead) {
    return {
      ...base,
      type: "skill",
      toolName: step.toolName ?? "skill.read",
      detail: step.detail || "",
      skillRead: step.skillRead,
    };
  }

  const calledIdx = step.title.indexOf(" called tool ");
  const toolName = step.toolName ?? (calledIdx >= 0 ? step.title.slice(calledIdx + " called tool ".length).trim() : "tool");
  if (toolName.startsWith("memory.")) {
    return { ...base, type: "memory", toolName, detail: step.detail || "" };
  }
  if (toolName.startsWith("goal.")) {
    return { ...base, type: "goal", toolName, detail: step.detail || "" };
  }
  if (toolName.startsWith("question.")) {
    return { ...base, type: "question", toolName, detail: step.detail || "" };
  }
  if (toolName.startsWith("self.procedure.")) {
    return { ...base, type: "procedure", toolName, detail: step.detail || "" };
  }
  if (toolName === "schedule") {
    return { ...base, type: "schedule", toolName, detail: step.detail || "" };
  }
  if (toolName === "agent.delegate") {
    return { ...base, type: "delegate", toolName, detail: step.detail || "" };
  }
  if (toolName === "message" || toolName.startsWith("channel.")) {
    return { ...base, type: "message", toolName, detail: step.detail || toolName };
  }
  return { ...base, type: "tool", toolName, detail: step.detail || "" };
}

function isToolStep(step: TraceStepData): boolean {
  return !!(
    step.filesystem ||
    step.grep ||
    step.webSearch ||
    step.terminal ||
    step.id.startsWith("tool:") ||
    step.title.includes(" called tool ")
  );
}

type AggregatedGroup = TraceStepData & {
  aggregatedOperations: AggregatedOperation[];
};

/**
 * Each run gets one unified activity flow. Keep the run boundary so separate
 * attempts remain distinct, but do not expose the run status as a header.
 */
function getGroupKey(step: TraceStepData): string {
  return step.taskId ?? step.runId ?? step.actorId;
}

export function groupTraceSteps(steps: TraceStepData[]): TraceStepData[] {
  const grouped: TraceStepData[] = [];
  let currentGroup: (AggregatedGroup & { groupKey: string }) | null = null;

  for (const step of steps) {
    if (isToolStep(step)) {
      const groupKey = getGroupKey(step);
      if (currentGroup && currentGroup.groupKey !== groupKey) {
        currentGroup = null;
      }
      if (!currentGroup) {
        currentGroup = {
          id: `aggregated-run-${step.id}`,
          title: step.actorName,
          detail: "",
          time: step.time,
          duration: step.duration,
          status: step.status,
          actorId: step.actorId,
          actorName: step.actorName,
          ...(step.runId ? { runId: step.runId } : {}),
          ...(step.taskId ? { taskId: step.taskId } : {}),
          groupKey,
          aggregatedOperations: [],
        };
        grouped.push(currentGroup);
      }
      currentGroup.aggregatedOperations.push(toolStepToOperation(step));
      currentGroup.status = currentGroup.aggregatedOperations.some((op) => op.status === "running")
        ? "running"
        : "success";
      currentGroup.time = step.time;
      currentGroup.duration = step.duration;
      continue;
    }

    if (step.title.startsWith("Run ·")) {
      currentGroup = null;
      continue;
    }

    currentGroup = null;
    grouped.push(step);
  }

  return grouped;
}
