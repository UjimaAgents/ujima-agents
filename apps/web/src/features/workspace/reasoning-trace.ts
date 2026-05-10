import type { ActivityEvent, ApprovalRequest, RunState } from "@ujima/shared";
import type { TraceStepData } from "./components/chat/details-sidebar";

const TRACE_ACTIVITY_TYPES = new Set([
  "tool_called",
  "tool_result",
  "run_queued",
  "run_running",
  "run_waiting_for_approval",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "approval_requested",
  "approval_approved",
  "approval_rejected",
  "channel_message",
  "thread_message",
]);

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  waiting_for_approval: "Waiting for approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export interface ReasoningTraceInput {
  threadId: string;
  /** When set (agent DM), only include runs and tools for this agent. */
  agentIdFilter?: string;
  conversationName: string;
  conversationType: "channel" | "agent";
  members: Array<{ id: string; name: string; kind?: string }>;
  activity: ActivityEvent[];
  runs: RunState[];
}

interface ToolSocketPayload {
  threadId?: string;
  runId?: string;
  agentId?: string;
  toolCall?: { toolCallId?: string; toolName?: string; args?: Record<string, unknown> };
  toolResult?: { toolCallId?: string; result?: unknown; isError?: boolean };
}

interface MessageActivityPayload {
  messageId?: string;
  threadId?: string;
  channelId?: string;
  content?: string;
}

function collectRunIdsForThread(input: ReasoningTraceInput): Set<string> {
  const ids = new Set<string>();
  const { threadId, agentIdFilter, runs, activity } = input;

  for (const run of runs) {
    if (run.threadId === threadId && (!agentIdFilter || run.agentId === agentIdFilter)) {
      ids.add(run.id);
    }
  }

  for (const event of activity) {
    if (event.type.startsWith("run_")) {
      const run = event.payload as RunState | undefined;
      if (
        run?.id &&
        run.threadId === threadId &&
        (!agentIdFilter || run.agentId === agentIdFilter)
      ) {
        ids.add(run.id);
      }
    }
    if (event.type === "tool_called" || event.type === "tool_result") {
      const body = event.payload as ToolSocketPayload;
      if (
        body.runId &&
        body.threadId === threadId &&
        (!agentIdFilter || body.agentId === agentIdFilter)
      ) {
        ids.add(body.runId);
      }
    }
  }

  return ids;
}

function approvalMatchesThread(
  approval: ApprovalRequest,
  runIdsForThread: Set<string>,
): boolean {
  return typeof approval.runId === "string" && runIdsForThread.has(approval.runId);
}

function toolPayloadMatchesThread(
  body: ToolSocketPayload,
  threadId: string,
  agentIdFilter: string | undefined,
  runIdsForThread: Set<string>,
): boolean {
  if (typeof body.threadId === "string" && body.threadId === threadId) {
    return !agentIdFilter || body.agentId === agentIdFilter;
  }
  if (typeof body.runId === "string" && runIdsForThread.has(body.runId)) {
    return !agentIdFilter || body.agentId === agentIdFilter;
  }
  return false;
}

function formatClock(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  return new Date(parsed).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncatePreview(value: unknown, max = 280): string {
  if (value == null) return "";
  let s: string;
  if (typeof value === "string") s = value;
  else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function extractToolErrorText(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const record = toObject(raw);
  if (!record) return undefined;
  const err = record.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  const reason = record.reason;
  if (typeof reason === "string" && reason.trim()) return reason.trim();
  return undefined;
}

function resolveMember(input: ReasoningTraceInput, memberId: string | undefined): { name: string; isAgent: boolean } {
  if (!memberId) return { name: "Unknown member", isAgent: false };
  const member = input.members.find((m) => m.id === memberId);
  if (!member) return { name: memberId, isAgent: false };
  return { name: member.name, isAgent: member.kind === "agent" };
}

function toObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function inferToolAction(args?: Record<string, unknown>): {
  action?: string;
  resourceType?: string;
  resourcePath?: string;
  input?: Record<string, unknown>;
  op?: string;
  command?: string;
} {
  const input = toObject(args?.input);
  const op = typeof input?.op === "string" ? input.op : undefined;
  const command = typeof input?.command === "string" ? input.command : undefined;
  return {
    action: typeof args?.action === "string" ? args.action : undefined,
    resourceType: typeof args?.resourceType === "string" ? args.resourceType : undefined,
    resourcePath: typeof args?.resourcePath === "string" ? args.resourcePath : undefined,
    input,
    op,
    command,
  };
}

function sentenceCase(value: string): string {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function deriveToolLine(
  input: ReasoningTraceInput,
  event: ActivityEvent | undefined,
  callBody: ToolSocketPayload | undefined,
): { title: string; detail?: string } {
  const actor = resolveMember(input, event?.publisher ?? callBody?.agentId);
  const toolName = callBody?.toolCall?.toolName ?? "tool";
  const parsed = inferToolAction(callBody?.toolCall?.args);
  const actorLabel = actor.isAgent ? `Agent ${actor.name}` : actor.name;
  const location =
    input.conversationType === "channel"
      ? `in Channel ${input.conversationName}`
      : `in the DM thread`;

  const path = parsed.resourcePath;
  const lowerOp = parsed.op?.toLowerCase();
  const lowerCommand = parsed.command?.toLowerCase();
  const isDeleteOp =
    lowerOp === "delete" || lowerOp === "remove" || (lowerCommand ? /\brm\b|\bdel\b/.test(lowerCommand) : false);
  const isCreateOp =
    lowerOp === "create" || lowerOp === "new" || lowerOp === "mkdir" || (lowerCommand ? /\bmkdir\b/.test(lowerCommand) : false);
  const isUpdateOp =
    lowerOp === "update" || lowerOp === "edit" || lowerOp === "patch" || lowerOp === "write";
  const isReadOp = lowerOp === "read" || lowerOp === "view";

  if (parsed.action === "write" && parsed.resourceType === "file" && path) {
    return {
      title: `${actorLabel} is writing to ${path}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.resourceType === "file" && path && isDeleteOp) {
    return {
      title: `${actorLabel} deleted file ${path}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.resourceType === "file" && path && isCreateOp) {
    return {
      title: `${actorLabel} created file ${path}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.resourceType === "file" && path && isReadOp) {
    return {
      title: `${actorLabel} read file ${path}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if ((parsed.action === "execute" || parsed.action === "write") && parsed.resourceType === "file" && path) {
    return {
      title: `${actorLabel} updated file ${path}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.resourceType === "folder" && path && isDeleteOp) {
    return {
      title: `${actorLabel} deleted folder ${path}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.resourceType === "folder" && path && isCreateOp) {
    return {
      title: `${actorLabel} created folder ${path}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if ((parsed.action === "write" || parsed.action === "execute") && parsed.resourceType === "folder" && path && isUpdateOp) {
    return {
      title: `${actorLabel} updated folder ${path}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.action === "execute" && parsed.resourceType === "shell") {
    return {
      title: `${actorLabel} ran a shell command`,
      detail: parsed.command ? `$ ${truncatePreview(parsed.command, 200)}` : `${actorLabel} called ${toolName} ${location}.`,
    };
  }

  return {
    title: `${actorLabel} called tool ${toolName}`,
    detail:
      parsed.resourcePath
        ? `${sentenceCase(parsed.action ?? "used")} ${parsed.resourceType ?? "resource"} ${parsed.resourcePath}.`
        : `${actorLabel} used ${toolName} ${location}.`,
  };
}

/** Avoid duplicating the agent's chat reply — `run.summary` on completed runs is often the full message body. */
function runDetailForTrace(run: RunState): string {
  if (run.status === "completed") {
    return "Finished — see the conversation for the full reply.";
  }
  if (run.status === "failed" || run.status === "cancelled") {
    const text = run.summary?.trim() || run.step?.trim();
    return text ? truncatePreview(text, 220) : `Run ${run.id.slice(0, 8)}…`;
  }
  const operational = run.step?.trim() || run.summary?.trim();
  if (!operational) return `Run ${run.id.slice(0, 8)}…`;
  return operational.length <= 160 ? operational : truncatePreview(operational, 160);
}

function runEventToStep(event: ActivityEvent, run: RunState): TraceStepData {
  const label = RUN_STATUS_LABELS[run.status] ?? run.status;
  const detail = runDetailForTrace(run);
  const status: TraceStepData["status"] =
    run.status === "failed" || run.status === "cancelled"
      ? "failed"
      : run.status === "completed"
        ? "success"
        : "running";
  return {
    id: event.event_id,
    title: `Run · ${label}`,
    detail,
    time: formatClock(event.timestamp),
    duration: "—",
    status,
    subtext: run.status === "failed" ? "Run ended with an error." : undefined,
  };
}

function approvalEventToStep(
  input: ReasoningTraceInput,
  event: ActivityEvent,
  approval: ApprovalRequest,
): TraceStepData {
  const pending = approval.status === "pending";
  const actor = resolveMember(input, approval.requestedBy);
  const actorLabel = actor.isAgent ? `Agent ${actor.name}` : actor.name;
  const title = pending
    ? `${actorLabel} requested ${approval.action} access to ${approval.resourcePath}`
    : approval.status === "approved"
      ? `Access granted to ${actorLabel}`
      : `Access denied for ${actorLabel}`;
  const status: TraceStepData["status"] = pending
    ? "running"
    : approval.status === "rejected"
      ? "failed"
      : "success";
  return {
    id: event.event_id,
    title,
    detail: `${approval.action} · ${approval.resourcePath}`,
    time: formatClock(event.timestamp),
    duration: "—",
    status,
    subtext: approval.reason ? truncatePreview(approval.reason, 200) : undefined,
  };
}

function buildToolStep(
  input: ReasoningTraceInput,
  toolCallId: string,
  call: ActivityEvent | undefined,
  result: ActivityEvent | undefined,
): TraceStepData {
  const callBody = call?.payload as ToolSocketPayload | undefined;
  const resultBody = result?.payload as ToolSocketPayload | undefined;
  const name =
    callBody?.toolCall?.toolName ??
    (resultBody as { toolName?: string } | undefined)?.toolName ??
    "tool";
  const argsPreview = callBody?.toolCall?.args ? truncatePreview(callBody.toolCall.args, 220) : "";
  const resultPreview = resultBody?.toolResult?.result
    ? truncatePreview(resultBody.toolResult.result, 320)
    : "";
  const isError = resultBody?.toolResult?.isError === true;
  const errorText = extractToolErrorText(resultBody?.toolResult?.result);
  const hasResult = !!result;

  let duration = "—";
  if (call && result) {
    const a = Date.parse(call.timestamp);
    const b = Date.parse(result.timestamp);
    if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) {
      duration = formatDurationMs(b - a);
    }
  }

  const ts = call?.timestamp ?? result?.timestamp ?? new Date().toISOString();

  const status: TraceStepData["status"] = !hasResult
    ? "running"
    : isError
      ? "failed"
      : "success";

  const line = deriveToolLine(input, call ?? result, callBody);

  return {
    id: `tool:${toolCallId}:${call?.event_id ?? ""}:${result?.event_id ?? ""}`,
    title: line.title,
    detail: line.detail ?? (argsPreview || `${name} called`),
    time: formatClock(ts),
    duration,
    status,
    subtext: hasResult
      ? isError
        ? `Error: ${errorText ?? (resultPreview || "unknown error")}`
        : resultPreview || "Done."
      : "Waiting for result…",
  };
}

function findMentionedMember(
  content: string | undefined,
  members: ReasoningTraceInput["members"],
  senderId: string,
): { id: string; name: string; isAgent: boolean } | undefined {
  if (!content) return undefined;
  const lower = content.toLowerCase();
  for (const member of members) {
    if (member.id === senderId) continue;
    const mention = `@${member.name.toLowerCase()}`;
    if (!lower.includes(mention)) continue;
    return { id: member.id, name: member.name, isAgent: member.kind === "agent" };
  }
  return undefined;
}

function messageEventToStep(input: ReasoningTraceInput, event: ActivityEvent): TraceStepData {
  const actor = resolveMember(input, event.publisher);
  const actorLabel = actor.isAgent ? `Agent ${actor.name}` : actor.name;
  const body = (event.payload ?? {}) as MessageActivityPayload;
  const mentioned = findMentionedMember(body.content, input.members, event.publisher);
  const mentionedLabel =
    mentioned && mentioned.isAgent ? `Agent ${mentioned.name}` : mentioned?.name;
  const target =
    input.conversationType === "channel"
      ? `in Channel ${input.conversationName}`
      : "in the direct thread";
  return {
    id: event.event_id,
    title:
      mentionedLabel && actor.isAgent
        ? `${actorLabel} responded to ${mentionedLabel} ${target}`
        : `${actorLabel} sent a message ${target}`,
    detail: "Message posted.",
    time: formatClock(event.timestamp),
    duration: "—",
    status: "success",
  };
}

interface OrderedStep {
  sortIndex: number;
  step: TraceStepData;
}

function toolCallIdFromPayload(
  event: ActivityEvent,
  kind: "tool_called" | "tool_result",
): string {
  const body = event.payload as ToolSocketPayload;
  if (kind === "tool_called") {
    return body.toolCall?.toolCallId ?? event.event_id;
  }
  return body.toolResult?.toolCallId ?? body.toolCall?.toolCallId ?? event.event_id;
}

/**
 * Builds ordered reasoning-trace steps for the Message details pane from live activity + runs.
 */
export function buildReasoningTraceSteps(input: ReasoningTraceInput): TraceStepData[] {
  const runIdsForThread = collectRunIdsForThread(input);
  const { threadId, agentIdFilter, activity } = input;

  const filtered = activity.filter((event) => {
    if (!TRACE_ACTIVITY_TYPES.has(event.type)) return false;

    if (event.type.startsWith("run_")) {
      const run = event.payload as RunState | undefined;
      if (!run?.id || run.threadId !== threadId) return false;
      if (agentIdFilter && run.agentId !== agentIdFilter) return false;
      return true;
    }

    if (event.type === "tool_called" || event.type === "tool_result") {
      const body = event.payload as ToolSocketPayload;
      return toolPayloadMatchesThread(body, threadId, agentIdFilter, runIdsForThread);
    }

    if (
      event.type === "approval_requested" ||
      event.type === "approval_approved" ||
      event.type === "approval_rejected"
    ) {
      const approval = event.payload as ApprovalRequest;
      return approvalMatchesThread(approval, runIdsForThread);
    }
    if (event.type === "channel_message" || event.type === "thread_message") {
      const payload = event.payload as MessageActivityPayload;
      if (event.type === "channel_message" && input.conversationType !== "channel") return false;
      if (event.type === "thread_message" && input.conversationType !== "agent") return false;
      if (typeof payload.threadId !== "string" || payload.threadId !== threadId) return false;
      if (agentIdFilter && event.publisher !== agentIdFilter) return false;
      return true;
    }

    return false;
  });

  const sorted = filtered.slice().sort((a, b) => {
    const at = Date.parse(a.timestamp);
    const bt = Date.parse(b.timestamp);
    if (Number.isNaN(at) || Number.isNaN(bt)) return 0;
    if (at !== bt) return at - bt;
    return a.event_id.localeCompare(b.event_id);
  });

  const toolMerge = new Map<string, { call?: ActivityEvent; result?: ActivityEvent }>();
  const toolFirstIndex = new Map<string, number>();
  const ordered: OrderedStep[] = [];

  sorted.forEach((event, index) => {
    if (event.type === "tool_called") {
      const id = toolCallIdFromPayload(event, "tool_called");
      if (!toolFirstIndex.has(id)) toolFirstIndex.set(id, index);
      const slot = toolMerge.get(id) ?? {};
      slot.call = event;
      toolMerge.set(id, slot);
      return;
    }
    if (event.type === "tool_result") {
      const id = toolCallIdFromPayload(event, "tool_result");
      if (!toolFirstIndex.has(id)) toolFirstIndex.set(id, index);
      const slot = toolMerge.get(id) ?? {};
      slot.result = event;
      toolMerge.set(id, slot);
      return;
    }
    if (event.type.startsWith("run_")) {
      ordered.push({
        sortIndex: index,
        step: runEventToStep(event, event.payload as RunState),
      });
      return;
    }
    if (event.type === "channel_message" || event.type === "thread_message") {
      ordered.push({
        sortIndex: index,
        step: messageEventToStep(input, event),
      });
      return;
    }
    if (
      event.type === "approval_requested" ||
      event.type === "approval_approved" ||
      event.type === "approval_rejected"
    ) {
      ordered.push({
        sortIndex: index,
        step: approvalEventToStep(input, event, event.payload as ApprovalRequest),
      });
    }
  });

  const maxIndex = sorted.length;
  for (const [toolCallId, pair] of toolMerge) {
    ordered.push({
      sortIndex: toolFirstIndex.get(toolCallId) ?? maxIndex,
      step: buildToolStep(input, toolCallId, pair.call, pair.result),
    });
  }

  ordered.sort((a, b) => {
    if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
    return a.step.title.localeCompare(b.step.title);
  });

  return ordered.map((o) => o.step);
}
