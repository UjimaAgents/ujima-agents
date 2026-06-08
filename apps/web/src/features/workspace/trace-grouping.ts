import type { TraceStepData } from "./components/chat/details-sidebar";

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

function getDiffStats(body?: string): { additions: number; deletions: number } {
  if (!body) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const line of body.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

function toolStepToOperation(step: TraceStepData): AggregatedOperation {
  const base = { id: step.id, additions: 0, deletions: 0, status: step.status };

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
      ...(isWrite || isDelete ? getDiffStats(body) : {}),
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

  const calledIdx = step.title.indexOf(" called tool ");
  const toolName = calledIdx >= 0 ? step.title.slice(calledIdx + " called tool ".length).trim() : "tool";
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

function groupStatusLabel(status: TraceStepData["status"]): string {
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "completed";
}

/**
 * Stable continuity key for a tool group. Two consecutive tool steps
 * belong in the same card iff they share this key. Prefer `runId`
 * (one card per agent run, which is the real transactional boundary);
 * fall back to `actorId` for tool events that lack a runId so we
 * still avoid the cross-actor fold.
 */
function getGroupKey(step: TraceStepData): string {
  return step.runId ?? step.actorId;
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
          title: `${step.actorName} · running`,
          detail: "",
          time: step.time,
          duration: step.duration,
          status: step.status,
          actorId: step.actorId,
          actorName: step.actorName,
          ...(step.runId ? { runId: step.runId } : {}),
          groupKey,
          aggregatedOperations: [],
        };
        grouped.push(currentGroup);
      }
      currentGroup.aggregatedOperations.push(toolStepToOperation(step));
      currentGroup.status = currentGroup.aggregatedOperations.some((op) => op.status === "failed")
        ? "failed"
        : step.status === "running"
          ? "running"
          : "success";
      currentGroup.title = `${currentGroup.actorName} · ${groupStatusLabel(currentGroup.status)}`;
      currentGroup.duration = step.duration;
      continue;
    }

    if (step.title.startsWith("Run ·")) {
      currentGroup = {
        id: `aggregated-run-${step.id}`,
        title: `${step.actorName} · ${step.status}`,
        detail: "",
        time: step.time,
        duration: step.duration,
        status: step.status,
        actorId: step.actorId,
        actorName: step.actorName,
        ...(step.runId ? { runId: step.runId } : {}),
        groupKey: getGroupKey(step),
        aggregatedOperations: [],
      };
      grouped.push(currentGroup);
      continue;
    }

    currentGroup = null;
    grouped.push(step);
  }

  return grouped;
}
