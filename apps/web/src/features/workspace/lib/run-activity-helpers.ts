import type { ActivityEvent, RunState } from "@ujima/shared/browser";
import type { StatusVariant } from "../components/chat/primitives";

// ── Public model ──────────────────────────────────────────────────────

export interface RunActivitySummary {
  /** One-line summary of what this run is doing/did. */
  summary: string;
  /** The latest meaningful operation label. Empty string when idle. */
  latestOperation: string;
  /** Status badge variant + label for the StatusBadge component. */
  statusBadge: { variant: StatusVariant; label: string };
  /** The N most recent operation labels. */
  recentOperations: string[];
}

export interface OperationEvent {
  label: string;
  timestamp: string;
  kind: OperationKind;
}

export type OperationKind =
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "approval_wait"
  | "input_wait"
  | "error";

// ── Helpers ───────────────────────────────────────────────────────────

const TOOL_NAME_LABELS: Record<string, string> = {
  view: "Reading file",
  ls: "Listing directory",
  glob: "Searching files",
  grep: "Searching code",
  write: "Writing file",
  edit: "Editing file",
  multiedit: "Editing files",
  shell: "Running command",
  download: "Downloading",
  fetch: "Fetching URL",
  web_search: "Searching web",
  "memory.write": "Saved memory",
  "memory.recall": "Recalled memory",
  "memory.forget": "Forgot memory",
  "goal.start": "Creating goal",
  "goal.task.update": "Updating task",
  "question.ask": "Asking question",
  "channel.reply": "Replying",
  "channel.close": "Closing thread",
  "channel.recall": "Recalling context",
  "channel.read": "Reading messages",
  "channel.list": "Listing channels",
  "channel.set_member_mode": "Setting member mode",
  "agent.delegate": "Delegating task",
  "agent.manage": "Managing agents",
  procedure: "Managing procedures",
  schedule: "Managing schedule",
  "skill.read": "Reading skill",
};

function toolNameToLabel(toolName: string): string {
  return TOOL_NAME_LABELS[toolName] ?? `Using ${toolName}`;
}

function runStatusToVariant(status: RunState["status"]): StatusVariant {
  switch (status) {
    case "completed":
      return "active";
    case "running":
      return "active";
    case "waiting_for_approval":
    case "waiting_for_input":
      return "idle";
    case "failed":
    case "cancelled":
      return "error";
    default:
      return "idle";
  }
}

function runStatusToLabel(status: RunState["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "waiting_for_approval":
      return "Approval";
    case "waiting_for_input":
      return "Input";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function extractToolName(payload: unknown): string | undefined {
  const obj = objOrUndefined(payload);
  if (!obj) return undefined;
  const toolCall = objOrUndefined(obj.toolCall);
  if (toolCall && typeof toolCall.toolName === "string") return toolCall.toolName;
  const toolResult = objOrUndefined(obj.toolResult);
  if (toolResult && typeof toolResult.toolName === "string") return toolResult.toolName;
  return undefined;
}

function isErrorResult(payload: unknown): boolean {
  const obj = objOrUndefined(payload);
  if (!obj) return false;
  const toolResult = objOrUndefined(obj.toolResult);
  return toolResult?.isError === true;
}

function isApprovalWait(payload: unknown): boolean {
  const obj = objOrUndefined(payload);
  if (!obj) return false;
  const result = objOrUndefined(obj.toolResult)?.result;
  const rec = objOrUndefined(result);
  return rec?.status === "waiting_for_approval";
}

function extractRunChunkKind(payload: unknown): string | undefined {
  const obj = objOrUndefined(payload);
  if (!obj) return undefined;
  return typeof obj.kind === "string" ? obj.kind : undefined;
}

function objOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toOperationEvent(
  event: ActivityEvent,
  _activity: readonly ActivityEvent[],
  _index: number,
): OperationEvent | null {
  const payload = event.payload;

  if (event.type === "run_chunk") {
    const kind = extractRunChunkKind(payload);
    if (kind === "reasoning") {
      return { label: "Thinking", timestamp: event.timestamp, kind: "reasoning" };
    }
    return { label: "Writing", timestamp: event.timestamp, kind: "tool_call" };
  }

  if (event.type === "tool_called") {
    const toolName = extractToolName(payload);
    if (!toolName) return { label: "Using tool", timestamp: event.timestamp, kind: "tool_call" };
    return { label: toolNameToLabel(toolName), timestamp: event.timestamp, kind: "tool_call" };
  }

  if (event.type === "tool_result") {
    if (isErrorResult(payload)) {
      return { label: "Tool error", timestamp: event.timestamp, kind: "error" };
    }
    if (isApprovalWait(payload)) {
      return { label: "Approval required", timestamp: event.timestamp, kind: "approval_wait" };
    }
    const toolName = extractToolName(payload);
    if (toolName) {
      return { label: `${toolNameToLabel(toolName)} done`, timestamp: event.timestamp, kind: "tool_result" };
    }
    return { label: "Tool finished", timestamp: event.timestamp, kind: "tool_result" };
  }

  if (event.type === "approval_requested") {
    return { label: "Approval required", timestamp: event.timestamp, kind: "approval_wait" };
  }

  if (event.type === "run_waiting_for_input") {
    return { label: "Waiting for input", timestamp: event.timestamp, kind: "input_wait" };
  }

  if (event.type === "run_failed") {
    return { label: "Failed", timestamp: event.timestamp, kind: "error" };
  }

  return null;
}

// ── Main public function ──────────────────────────────────────────────

/**
 * Turn a run and its associated activity events into a compact summary
 * suitable for agent pills, task board cards, and chat row headers.
 */
export function summarizeRunActivity(
  run: RunState,
  activity: readonly ActivityEvent[],
  maxRecent = 3,
): RunActivitySummary {
  const statusBadge: RunActivitySummary["statusBadge"] = {
    variant: runStatusToVariant(run.status),
    label: runStatusToLabel(run.status),
  };

  // Collect operation events in reverse chronological order.
  const ops: OperationEvent[] = [];
  for (let i = activity.length - 1; i >= 0; i -= 1) {
    const event = activity[i];
    if (event.task_id !== run.id) continue;
    const op = toOperationEvent(event, activity, i);
    if (op) ops.push(op);
  }

  // Latest meaningful operation.
  const latest = ops[0]?.label ?? "";
  const recent = ops.slice(0, maxRecent).map((op) => op.label);

  // Summary from run metadata or status.
  const summary = run.summary?.trim() || run.step?.trim() || runStatusToLabel(run.status);

  return { summary, latestOperation: latest, statusBadge, recentOperations: recent };
}

/**
 * Status badge data derived purely from run state (no activity events needed).
 */
export function runStatusBadge(status: RunState["status"]): {
  variant: StatusVariant;
  label: string;
} {
  return { variant: runStatusToVariant(status), label: runStatusToLabel(status) };
}
