import {
  parseFilesystemToolCallArgs,
  parseGrepToolCallArgs,
  parseShellToolCallArgs,
  parseWebSearchToolCallArgs,
  shellInvocationDisplayLine,
  type ActivityEvent,
  type Message,
  type RunState,
  type RunStep,
} from "@ujima/shared";
import type { TraceStepData } from "./components/chat/details-sidebar";
import { formatTimestamp } from "./lib/format-timestamp";

const TRACE_ACTIVITY_TYPES = new Set([
  "tool_called",
  "tool_result",
  "run_queued",
  "run_running",
  "run_waiting_for_approval",
  "run_completed",
  "run_failed",
  "run_cancelled",
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
  members: { id: string; name: string; kind?: string }[];
  activity: ActivityEvent[];
  runs: RunState[];
  /** Current workspace org — required for background shell job streaming in the trace. */
  organizationId?: string;
}

export interface HistoricalTraceInput {
  conversationName: string;
  conversationType: "channel" | "agent";
  members: ReasoningTraceInput["members"];
  run: RunState;
  steps: RunStep[];
  message?: Message;
  organizationId?: string;
}

interface ToolSocketPayload {
  threadId?: string;
  runId?: string;
  organizationId?: string;
  agentId?: string;
  toolCall?: { toolCallId?: string; toolName?: string; args?: Record<string, unknown> };
  toolResult?: { toolCallId?: string; result?: unknown; isError?: boolean };
}

function mergeToolCallActivityPayload(
  callBody: ToolSocketPayload | undefined,
  resultBody: ToolSocketPayload | undefined,
): ToolSocketPayload | undefined {
  if (!callBody && !resultBody) return undefined;
  return {
    ...(resultBody ?? {}),
    ...(callBody ?? {}),
    toolCall: callBody?.toolCall ?? resultBody?.toolCall,
    toolResult: resultBody?.toolResult ?? callBody?.toolResult,
  };
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

const MAX_TERMINAL_CHARS = 16_384;

function extractShellBackgroundJobId(result: unknown): string | undefined {
  const rec = toObject(result);
  if (!rec || typeof rec.job_id !== "string" || !rec.job_id.trim()) return undefined;
  return rec.job_id.trim();
}

function truncateTerminalText(text: string): string {
  if (text.length <= MAX_TERMINAL_CHARS) return text;
  return `${text.slice(0, MAX_TERMINAL_CHARS)}\n\n… (truncated)`;
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return toObject(parsed);
    } catch {
      return undefined;
    }
  }
  return toObject(value);
}

function shellToolAggregateOutput(result: unknown, isError: boolean, errorText?: string): string {
  if (isError) {
    const base = errorText?.trim() || "";
    if (base) return truncateTerminalText(base);
    try {
      return truncateTerminalText(JSON.stringify(result, null, 2));
    } catch {
      return truncateTerminalText(String(result));
    }
  }
  const rec = toObject(result);
  if (rec && typeof rec.status === "string") {
    if (rec.status === "waiting_for_approval") {
      return "";
    }
    if (rec.status === "blocked") {
      const reason = typeof rec.reason === "string" ? rec.reason : "Blocked by policy.";
      return truncateTerminalText(reason);
    }
  }
  const out = typeof rec?.stdout === "string" ? rec.stdout : "";
  const err = typeof rec?.stderr === "string" ? rec.stderr : "";
  const parts: string[] = [];
  if (out.trim()) parts.push(out.trimEnd());
  if (err.trim()) parts.push(`stderr:\n${err.trimEnd()}`);
  const joined = parts.join("\n\n").trim();
  if (!joined) return "";
  return truncateTerminalText(joined);
}

function filesystemToolAggregateOutput(result: unknown, isError: boolean, errorText?: string): string {
  if (isError) {
    const base = errorText?.trim() || "";
    if (base) return truncateTerminalText(base);
    try {
      return truncateTerminalText(JSON.stringify(result, null, 2));
    } catch {
      return truncateTerminalText(String(result));
    }
  }
  const rec = parseMaybeJsonObject(result);
  if (rec && typeof rec.status === "string") {
    if (rec.status === "waiting_for_approval") {
      return "";
    }
    if (rec.status === "blocked") {
      const reason = typeof rec.reason === "string" ? rec.reason : "Blocked by policy.";
      return truncateTerminalText(reason);
    }
  }
  if (rec?.type === "file" && typeof rec.content === "string") {
    return truncateTerminalText(rec.content);
  }
  if (rec && rec.success === true) {
    return truncateTerminalText("Saved.");
  }
  return "";
}

/** Tool returned but the action did not complete (approval, policy block, etc.). */
function toolResultPendingCompletion(result: unknown, isError: boolean): boolean {
  if (isError) return false;
  const rec = toObject(result);
  if (!rec || typeof rec.status !== "string") return false;
  return (
    rec.status === "waiting_for_approval" ||
    rec.status === "pending_approval" ||
    rec.status === "blocked" ||
    rec.status === "streaming"
  );
}

function inferToolAction(args?: Record<string, unknown>): {
  action?: string;
  resourceType?: string;
  resourcePath?: string;
  input?: Record<string, unknown>;
  op?: string;
  command?: string;
  offset?: number;
  limit?: number;
  query?: string;
} {
  const input = toObject(args?.input);
  const op = typeof input?.op === "string" ? input.op : undefined;
  const command = typeof input?.command === "string" ? input.command : undefined;
  const offset =
    typeof args?.offset === "number"
      ? args.offset
      : typeof input?.offset === "number"
        ? input.offset
        : undefined;
  const limit =
    typeof args?.limit === "number"
      ? args.limit
      : typeof input?.limit === "number"
        ? input.limit
        : undefined;
  const query =
    typeof args?.query === "string"
      ? args.query
      : typeof input?.query === "string"
        ? input.query
        : undefined;
  return {
    action: typeof args?.action === "string" ? args.action : undefined,
    resourceType: typeof args?.resourceType === "string" ? args.resourceType : undefined,
    resourcePath: typeof args?.resourcePath === "string" ? args.resourcePath : undefined,
    input,
    op,
    command,
    offset,
    limit,
    query,
  };
}

interface WebSearchTraceData {
  query: string;
  site?: string;
  status: "streaming" | "completed";
  source: string;
  results: WebSearchResultTraceData[];
}

interface WebSearchResultTraceData {
  title: string;
  url: string;
  snippet: string;
  source: string;
  rank: number;
}

function normalizeWebSearchResults(result: unknown): WebSearchResultTraceData[] {
  const rec = toObject(result);
  if (!rec || !Array.isArray(rec.results)) return [];
  return rec.results
    .map((entry) => {
      const item = toObject(entry);
      const title = typeof item?.title === "string" ? item.title : "";
      const url = typeof item?.url === "string" ? item.url : "";
      const snippet = typeof item?.snippet === "string" ? item.snippet : "";
      const source = typeof item?.source === "string" ? item.source : "";
      const rank = typeof item?.rank === "number" ? item.rank : 0;
      if (!title || !url) return null;
      return {
        title,
        url,
        snippet,
        source,
        rank,
      };
    })
    .filter((item): item is WebSearchResultTraceData => item !== null);
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
  const toolName = (
    callBody?.toolCall?.toolName ??
    (callBody as { toolName?: string } | undefined)?.toolName ??
    "tool"
  ).toLowerCase();
  const parsed = inferToolAction(callBody?.toolCall?.args);
  const actorLabel = actor.name;
  const location =
    input.conversationType === "channel"
      ? `in Channel ${input.conversationName}`
      : `in the DM thread`;

  const path = parsed.resourcePath;
  const windowLabel =
    typeof parsed.offset === "number" || typeof parsed.limit === "number"
      ? ` [offset=${parsed.offset ?? 1}, limit=${parsed.limit ?? 20}]`
      : "";
  const lowerOp = parsed.op?.toLowerCase();
  const lowerCommand = parsed.command?.toLowerCase();

  if (toolName === "filesystem" && path) {
    const a = parsed.action?.toLowerCase();
    if (a === "read") {
      return {
        title: `${actorLabel} · read ${path}${windowLabel}`,
        detail: "",
      };
    }
    if (a === "write") {
      return {
        title: `${actorLabel} · patch`,
        detail: "",
      };
    }
  }

  if (toolName === "shell") {
    return {
      title: `${actorLabel} · shell`,
      detail: "",
    };
  }

  if (toolName === "grep") {
    const query = parsed.query ?? "";
    return {
      title: query
        ? `${actorLabel} · grep "${query}"`
        : `${actorLabel} · grep`,
      detail: "",
    };
  }

  if (toolName === "web_search") {
    return {
      title: `${actorLabel} · web search`,
      detail: "",
    };
  }

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

  return {
    title: `${actorLabel} called tool ${toolName}`,
    detail:
      parsed.resourcePath
        ? `${sentenceCase(parsed.action ?? "used")} ${parsed.resourceType ?? "resource"} ${parsed.resourcePath}.`
        : `${actorLabel} used ${toolName} ${location}.`,
  };
}

/** Normalize for comparing human-written step text to status labels. */
function normalizeRunDetailLabel(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when step/summary only repeats the same status already shown in the title ("Run · Queued"). */
function runDetailOnlyEchoesStatus(status: RunState["status"], operational: string): boolean {
  const t = normalizeRunDetailLabel(operational);
  if (!t) return true;
  const variants = new Set<string>([
    normalizeRunDetailLabel(status),
    normalizeRunDetailLabel(status.replace(/_/g, " ")),
  ]);
  const mapped = RUN_STATUS_LABELS[status];
  if (mapped) variants.add(normalizeRunDetailLabel(mapped));
  return variants.has(t);
}

/** Completed runs often duplicate the agent message in `run.summary`; omit detail in the trace. */
function runDetailForTrace(run: RunState): string {
  if (run.status === "completed") {
    return "";
  }
  if (run.status === "failed" || run.status === "cancelled") {
    const text = run.summary?.trim() || run.step?.trim();
    return text ? truncatePreview(text, 220) : `Run ${run.id.slice(0, 8)}…`;
  }

  const operational = run.step?.trim() || run.summary?.trim();
  if (!operational) {
    return "";
  }
  if (runDetailOnlyEchoesStatus(run.status, operational)) {
    return "";
  }
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
    time: formatTimestamp(event.timestamp),
    duration: "—",
    status,
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
  const mergedPayload = mergeToolCallActivityPayload(callBody, resultBody);
  const name =
    (mergedPayload?.toolCall?.toolName ??
      (resultBody as { toolName?: string } | undefined)?.toolName ??
      "tool"
    ).toLowerCase();
  const argsPreview = mergedPayload?.toolCall?.args
    ? truncatePreview(mergedPayload.toolCall.args, 220)
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

  const pendingCompletion =
    hasResult && toolResultPendingCompletion(resultBody?.toolResult?.result, isError);

  const status: TraceStepData["status"] = !hasResult
    ? "running"
    : isError
      ? "failed"
      : pendingCompletion
        ? "running"
        : "success";

  let line = deriveToolLine(input, call ?? result, mergedPayload);

  let terminal: TraceStepData["terminal"] | undefined;
  if (name === "shell") {
    const shellArgs = parseShellToolCallArgs(
      mergedPayload?.toolCall?.args as Record<string, unknown> | undefined,
    );
    if (shellArgs) {
      const cmdLine = shellInvocationDisplayLine(shellArgs);
      const jobId =
        hasResult && !isError
          ? extractShellBackgroundJobId(resultBody?.toolResult?.result)
          : undefined;
      const runId = mergedPayload?.runId;
      const orgId =
        typeof mergedPayload?.organizationId === "string"
          ? mergedPayload.organizationId
          : input.organizationId;
      if (jobId && runId && orgId) {
        terminal = {
          cwd: shellArgs.cwd,
          commandLine: cmdLine,
          streamingJob: { runId, jobId, organizationId: orgId },
        };
      } else if (hasResult) {
        const outText = shellToolAggregateOutput(resultBody?.toolResult?.result, isError, errorText);
        terminal = {
          cwd: shellArgs.cwd,
          commandLine: cmdLine,
          output: outText,
          outputTone: isError ? "error" : "default",
        };
      } else {
        terminal = {
          cwd: shellArgs.cwd,
          commandLine: cmdLine,
        };
      }
    }
  }

  let filesystem: TraceStepData["filesystem"] | undefined;
  if (name === "filesystem") {
    const fsArgs = parseFilesystemToolCallArgs(
      mergedPayload?.toolCall?.args as Record<string, unknown> | undefined,
    );
    if (fsArgs) {
      const outText = hasResult
        ? filesystemToolAggregateOutput(resultBody?.toolResult?.result, isError, errorText)
        : "";
      const bodyFromResult = outText.trim() ? outText : undefined;
      const pendingPatch =
        typeof fsArgs.patch === "string" && fsArgs.patch.length > 0
          ? fsArgs.patch
          : typeof fsArgs.content === "string" && fsArgs.content.length > 0
            ? fsArgs.content
            : undefined;
      const showPendingWrite =
        (!hasResult || pendingCompletion) && fsArgs.action === "write" && pendingPatch !== undefined;
      const bodyFromCall = showPendingWrite ? pendingPatch : undefined;
      const trivialWriteSuccess =
        !isError &&
        hasResult &&
        (!bodyFromResult || bodyFromResult === "Saved.");
      const resolved =
        isError
          ? (bodyFromResult ?? bodyFromCall)
          : fsArgs.action === "write" &&
              pendingPatch &&
              (!hasResult || pendingCompletion || trivialWriteSuccess)
            ? pendingPatch
            : (bodyFromResult ?? bodyFromCall);
      filesystem = {
        action: fsArgs.action,
        resourcePath: fsArgs.resourcePath,
        meta:
          fsArgs.action === "read"
            ? `[offset=${fsArgs.offset ?? 1}, limit=${fsArgs.limit ?? 20}]`
            : undefined,
        body: resolved !== undefined && resolved.length > 0 ? resolved : undefined,
        bodyTone: isError ? "error" : "default",
      };
    }
  }

  let grep: TraceStepData["grep"] | undefined;
  if (name === "grep") {
    const grepArgs = parseGrepToolCallArgs(
      mergedPayload?.toolCall?.args as Record<string, unknown> | undefined,
    );
    if (grepArgs) {
      const result = resultBody?.toolResult?.result;
      const rec = parseMaybeJsonObject(result);
      const matches = Array.isArray(rec?.matches)
        ? rec.matches
            .map((entry) => {
              const item = toObject(entry);
              const path = typeof item?.path === "string" ? item.path : "";
              const lineNumber = typeof item?.lineNumber === "number" ? item.lineNumber : 0;
              const line = typeof item?.line === "string" ? item.line : "";
              if (!path || !lineNumber) return null;
              return { path, lineNumber, line };
            })
            .filter(
              (item): item is { path: string; lineNumber: number; line: string } =>
                item !== null,
            )
        : [];
      const count = typeof rec?.count === "number" ? rec.count : matches.length;
      const limit = typeof rec?.limit === "number" ? rec.limit : grepArgs.limit ?? 20;
      grep = {
        query: grepArgs.query,
        path: grepArgs.resourcePath,
        count,
        limit,
        truncated: typeof rec?.truncated === "boolean" ? rec.truncated : undefined,
        matches,
      };
    }
  }

  let webSearch: WebSearchTraceData | undefined;
  if (name === "web_search") {
    const webArgs = parseWebSearchToolCallArgs(
      mergedPayload?.toolCall?.args as Record<string, unknown> | undefined,
    );
    if (webArgs) {
      const result = resultBody?.toolResult?.result;
      const rec = toObject(result);
      const status =
        rec?.status === "completed"
          ? "completed"
          : "streaming";
      const source = typeof rec?.source === "string" ? rec.source : "duckduckgo";
      webSearch = {
        query: webArgs.query,
        site: webArgs.site,
        status,
        source,
        results: normalizeWebSearchResults(result),
      };
    }
  }

  const hasRich = !!(terminal || filesystem || grep || webSearch);

  return {
    id: `tool:${toolCallId}:${call?.event_id ?? ""}:${result?.event_id ?? ""}`,
    title: line.title,
    detail: hasRich ? "" : line.detail ?? (argsPreview || `${name} called`),
    time: formatTimestamp(ts),
    duration,
    status,
    terminal,
    filesystem,
    grep,
    webSearch,
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
  const actorLabel = actor.name;
  const body = (event.payload ?? {}) as MessageActivityPayload;
  const mentioned = findMentionedMember(body.content, input.members, event.publisher);
  const mentionedLabel = mentioned?.name;
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
    detail: "",
    time: formatTimestamp(event.timestamp),
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

export function buildHistoricalTraceSteps(input: HistoricalTraceInput): TraceStepData[] {
  const context: ReasoningTraceInput = {
    threadId: input.run.threadId ?? input.run.id,
    conversationName: input.conversationName,
    conversationType: input.conversationType,
    members: input.members,
    activity: [],
    runs: [input.run],
    organizationId: input.organizationId,
  };

  const steps: TraceStepData[] = [
    runEventToStep(
      {
        event_id: `run:${input.run.id}`,
        type: `run_${input.run.status}`,
        publisher: input.run.agentId,
        timestamp: input.run.startedAt,
        payload: input.run,
      },
      input.run,
    ),
    ...input.steps.map((step) => runStepToTraceStep(context, step)),
  ];

  if (input.message) {
    steps.push(
      messageEventToStep(context, {
        event_id: `message:${input.message.id}`,
        type: input.conversationType === "channel" ? "channel_message" : "thread_message",
        publisher: input.message.senderId,
        timestamp: input.message.createdAt,
        payload: {
          threadId: input.message.threadId,
          channelId: input.message.channelId,
          content: input.message.content,
        },
      }),
    );
  }

  return steps;
}

function runStepToTraceStep(input: ReasoningTraceInput, step: RunStep): TraceStepData {
  const call: ActivityEvent = {
    event_id: `run-step:${step.id}:call`,
    type: "tool_called",
    publisher: step.agentId,
    timestamp: step.createdAt,
    payload: {
      runId: step.runId,
      threadId: step.threadId,
      agentId: step.agentId,
      toolCall: {
        toolCallId: step.toolCallId,
        toolName: step.toolId,
        args: {
          ...step.input,
          action: step.action,
          resourceType: step.resourceType,
          resourcePath: step.resourcePath,
        },
      },
    },
  };
  const result: ActivityEvent = {
    event_id: `run-step:${step.id}:result`,
    type: "tool_result",
    publisher: step.agentId,
    timestamp: step.createdAt,
    payload: {
      runId: step.runId,
      threadId: step.threadId,
      agentId: step.agentId,
      toolResult: {
        toolCallId: step.toolCallId,
        result: step.output,
        isError: step.status === "error",
      },
    },
  };
  return buildToolStep(input, step.toolCallId, call, result);
}
