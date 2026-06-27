import {
  parseFilesystemToolCallArgs,
  parseGrepToolCallArgs,
  parseShellToolCallArgs,
  parseWebSearchToolCallArgs,
  compareActivityEvents,
  shellInvocationDisplayLine,
  type ActivityEvent,
  type Message,
  type RunChunkEvent,
  type RunState,
  type RunStep,
} from "@ujima/shared/browser";
import type { TraceStepData } from "./components/chat/details-sidebar";
import { formatTimestamp } from "./lib/format-timestamp";
import { collapseRunChunkActivities, runChunkActivityKey } from "./run-chunk-activity";

const TRACE_ACTIVITY_TYPES = new Set([
  "tool_called",
  "tool_result",
  "run_chunk",
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

const RUN_ACTIVITY_TYPES = new Set([
  "run_queued",
  "run_running",
  "run_waiting_for_approval",
  "run_completed",
  "run_failed",
  "run_cancelled",
]);

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
  reasoning?: string;
  runId?: string;
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
    if (RUN_ACTIVITY_TYPES.has(event.type)) {
      const run = event.payload as RunState | undefined;
      if (
        run?.id &&
        run.threadId === threadId &&
        (!agentIdFilter || run.agentId === agentIdFilter)
      ) {
        ids.add(run.id);
      }
    }
    if (event.type === "run_chunk") {
      const body = event.payload as RunChunkEvent | undefined;
      if (
        body?.runId &&
        body.threadId === threadId &&
        (!agentIdFilter || body.agentId === agentIdFilter)
      ) {
        ids.add(body.runId);
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

function unwrapResultRecord(value: unknown): Record<string, unknown> | undefined {
  const record = toObject(value);
  if (!record) return undefined;

  if (
    typeof record.content === "string" ||
    typeof record.diff === "string" ||
    typeof record.stdout === "string" ||
    typeof record.stderr === "string" ||
    Array.isArray(record.matches)
  ) {
    return record;
  }

  const nested = toObject(record.result) ?? toObject(record.data);
  return nested ? unwrapResultRecord(nested) ?? record : record;
}

function readStringArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = args?.[key];
  if (typeof value === "string") return value;
  const nestedValue = nested?.[key];
  return typeof nestedValue === "string" ? nestedValue : undefined;
}

function readNumberArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = args?.[key];
  if (typeof value === "number") return value;
  const nestedValue = nested?.[key];
  return typeof nestedValue === "number" ? nestedValue : undefined;
}

function readIntegerArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  for (const source of [args, nested]) {
    if (!source) continue;
    for (const key of keys) {
      const v = source[key];
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return undefined;
}

function readBooleanArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = args?.[key];
  if (typeof value === "boolean") return value;
  const nestedValue = nested?.[key];
  return typeof nestedValue === "boolean" ? nestedValue : undefined;
}

function readStringArrayArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const value = args?.[key];
  const candidate = Array.isArray(value) ? value : nested?.[key];
  return Array.isArray(candidate) && candidate.length ? candidate.map((item) => String(item)) : undefined;
}

function splitDiffLines(prefix: "+" | "-", value: string): string[] {
  return value.split(/\r?\n/).map((line) => `${prefix}${line}`);
}

function proposedWriteDiff(resourcePath: string, content: string): string {
  const lineCount = Math.max(1, content.split(/\r?\n/).length);
  return [
    `--- ${resourcePath}`,
    `+++ ${resourcePath}`,
    `@@ -0,0 +1,${lineCount} @@`,
    ...splitDiffLines("+", content),
  ].join("\n");
}

function proposedEditDiff(resourcePath: string, oldString: string, newString: string): string {
  return [
    `--- ${resourcePath}`,
    `+++ ${resourcePath}`,
    "@@",
    ...splitDiffLines("-", oldString),
    ...splitDiffLines("+", newString),
  ].join("\n");
}

function proposedMultiEditDiff(
  resourcePath: string | undefined,
  edits: { oldString?: string; newString?: string }[] | undefined,
): string | undefined {
  if (!resourcePath || !edits?.length) return undefined;
  const patch = edits
    .map((edit) =>
      edit.oldString !== undefined && edit.newString !== undefined
        ? proposedEditDiff(resourcePath, edit.oldString, edit.newString)
        : "",
    )
    .filter(Boolean)
    .join("\n");
  return patch || undefined;
}

function readEditArrayArg(
  args: Record<string, unknown> | undefined,
  nested: Record<string, unknown> | undefined,
): { oldString?: string; newString?: string }[] | undefined {
  const candidate = Array.isArray(args?.edits) ? args?.edits : nested?.edits;
  if (!Array.isArray(candidate)) return undefined;
  const edits: { oldString?: string; newString?: string }[] = [];
  for (const entry of candidate) {
    const item = toObject(entry);
    if (!item) continue;
    edits.push({
      oldString:
        typeof item.old_string === "string"
          ? item.old_string
          : typeof item.oldString === "string"
            ? item.oldString
            : undefined,
      newString:
        typeof item.new_string === "string"
          ? item.new_string
          : typeof item.newString === "string"
            ? item.newString
            : undefined,
    });
  }
  return edits.length ? edits : undefined;
}

const MAX_TERMINAL_CHARS = 16_384;
const MAX_RUN_CHUNK_DETAIL_CHARS = 4_096;

function extractShellBackgroundJobId(result: unknown): string | undefined {
  const rec = toObject(result);
  if (!rec || typeof rec.job_id !== "string" || !rec.job_id.trim()) return undefined;
  return rec.job_id.trim();
}

function truncateTerminalText(text: string): string {
  if (text.length <= MAX_TERMINAL_CHARS) return text;
  return `${text.slice(0, MAX_TERMINAL_CHARS)}\n\n… (truncated)`;
}

function extractContentFromResult(result: unknown): string | undefined {
  if (!result) return undefined;
  const rec = parseMaybeJsonObject(result);
  if (rec) {
    const content = rec.content;
    if (typeof content === "string" && content.trim()) return content.trimEnd();
    const text = rec.body ?? rec.text ?? rec.output;
    if (typeof text === "string" && text.trim()) return text.trimEnd();
    return undefined;
  }
  if (typeof result !== "string") return undefined;
  const match = result.match(/"(content|body|text|output)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match?.[2]) return extractTruncatedContentField(result);
  try {
    return JSON.parse(`"${match[2]}"`).trimEnd() || undefined;
  } catch {
    return match[2].trim() || undefined;
  }
}

function extractTruncatedContentField(text: string): string | undefined {
  for (const field of ["content", "body", "text", "output"]) {
    const marker = `"${field}"`;
    const keyIndex = text.indexOf(marker);
    if (keyIndex === -1) continue;
    const colonIndex = text.indexOf(":", keyIndex + marker.length);
    if (colonIndex === -1) continue;
    const quoteIndex = text.indexOf('"', colonIndex + 1);
    if (quoteIndex === -1) continue;
    const raw = text.slice(quoteIndex + 1).replace(/"\s*[},]?\s*$/, "");
    if (!raw.trim()) continue;
    try {
      return JSON.parse(`"${raw.replace(/\\$/, "")}"`).trimEnd() || undefined;
    } catch {
      return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').trimEnd() || undefined;
    }
  }
  return undefined;
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return unwrapResultRecord(parsed);
    } catch {
      return undefined;
    }
  }
  return unwrapResultRecord(value);
}

function toolAggregateOutput(
  toolName: string,
  result: unknown,
  isError: boolean,
  errorText?: string,
): string {
  if (isError) {
    const base = errorText?.trim() || "";
    if (base) return truncateTerminalText(base);
    try {
      return truncateTerminalText(JSON.stringify(result, null, 2));
    } catch {
      return truncateTerminalText(String(result));
    }
  }

  if (toolName === "view" || toolName === "read") {
    const content = extractContentFromResult(result);
    if (content) return truncateTerminalText(content);
  }

  const rec = parseMaybeJsonObject(result);
  if (rec) {
    if (toolName === "grep") {
      const lines = Array.isArray(rec.matches)
        ? rec.matches
            .map((entry) => {
              const item = toObject(entry);
              const path = typeof item?.path === "string" ? item.path : "";
              const lineNumber = typeof item?.lineNumber === "number" ? item.lineNumber : 0;
              const line = typeof item?.line === "string" ? item.line : "";
              if (!path || !lineNumber) return "";
              return `${path}:${lineNumber}${line ? `: ${line}` : ""}`;
            })
            .filter(Boolean)
        : [];
      if (lines.length > 0) {
        return truncateTerminalText(lines.join("\n"));
      }
      const content = extractContentFromResult(rec);
      if (content) return truncateTerminalText(content);
    }

    if (typeof rec?.diff === "string" && rec.diff.trim()) {
      return truncateTerminalText(rec.diff);
    }
    if (typeof rec?.content === "string" && rec.content.trim()) {
      return truncateTerminalText(rec.content);
    }
    if (Array.isArray(rec?.matches)) {
      const lines = rec.matches
        .map((entry) => {
          const item = toObject(entry);
          const path = typeof item?.path === "string" ? item.path : "";
          const lineNumber = typeof item?.lineNumber === "number" ? item.lineNumber : 0;
          const line = typeof item?.line === "string" ? item.line : "";
          if (!path || !lineNumber) return "";
          return `${path}:${lineNumber}${line ? `: ${line}` : ""}`;
        })
        .filter(Boolean);
      if (lines.length > 0) {
        return truncateTerminalText(lines.join("\n"));
      }
    }
    const out = typeof rec?.stdout === "string" ? rec.stdout : "";
    const err = typeof rec?.stderr === "string" ? rec.stderr : "";
    const parts: string[] = [];
    if (out.trim()) parts.push(out.trimEnd());
    if (err.trim()) parts.push(`stderr:\n${err.trimEnd()}`);
    const joined = parts.join("\n\n").trim();
    if (joined) return truncateTerminalText(joined);
    if (rec && typeof rec.status === "string") {
      if (rec.status === "waiting_for_approval") {
        return "";
      }
      if (rec.status === "blocked") {
        const reason = typeof rec.reason === "string" ? rec.reason : "Blocked by policy.";
        return truncateTerminalText(reason);
      }
    }
    if (typeof rec?.bytesWritten === "number") {
      return truncateTerminalText(`Saved ${rec.bytesWritten} bytes.`);
    }
    if (rec?.success === true) {
      return truncateTerminalText("Saved.");
    }
    if (typeof rec?.status === "string" && rec.status.trim()) {
      return truncateTerminalText(rec.status);
    }
  }
  if (typeof result === "string" && result.trim()) {
    return truncateTerminalText(result);
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
    rec.status === "streaming" ||
    rec.status === "running"
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
  startLine?: number;
  endLine?: number;
  query?: string;
  pattern?: string;
  depth?: number;
  content?: string;
  patch?: string;
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  edits?: { oldString?: string; newString?: string }[];
  ignore?: string[];
  url?: string;
  jobId?: string;
  wait?: boolean;
  channelId?: string;
  memberId?: string;
  messageId?: string;
  body?: string;
  reason?: string;
  note?: string;
} {
  const input = toObject(args?.input);
  const nested = input;
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

  const startLine = readIntegerArg(args, input, "startLine", "StartLine");
  const endLine = readIntegerArg(args, input, "endLine", "EndLine");

  const query =
    typeof args?.query === "string"
      ? args.query
      : typeof input?.query === "string"
        ? input.query
        : undefined;
  const pattern = readStringArg(args, nested, "pattern");
  const depth = readNumberArg(args, nested, "depth");
  const content = readStringArg(args, nested, "content");
  const patch = readStringArg(args, nested, "patch");
  const oldString = readStringArg(args, nested, "old_string") ?? readStringArg(args, nested, "oldString");
  const newString = readStringArg(args, nested, "new_string") ?? readStringArg(args, nested, "newString");
  const replaceAll = readBooleanArg(args, nested, "replace_all") ?? readBooleanArg(args, nested, "replaceAll");
  const edits = readEditArrayArg(args, nested);
  const ignore = readStringArrayArg(args, nested, "ignore");
  const url = readStringArg(args, nested, "url");
  const jobId = readStringArg(args, nested, "job_id") ?? readStringArg(args, nested, "jobId");
  const wait = readBooleanArg(args, nested, "wait");
  const channelId = readStringArg(args, nested, "channel_id") ?? readStringArg(args, nested, "channelId");
  const memberId = readStringArg(args, nested, "member_id") ?? readStringArg(args, nested, "memberId");
  const messageId = readStringArg(args, nested, "message_id") ?? readStringArg(args, nested, "messageId");
  const body = readStringArg(args, nested, "body") ?? readStringArg(args, nested, "content");
  const reason = readStringArg(args, nested, "reason");
  const note = readStringArg(args, nested, "note");
  return {
    action: typeof args?.action === "string" ? args.action : undefined,
    resourceType: typeof args?.resourceType === "string" ? args.resourceType : undefined,
    resourcePath:
      readStringArg(args, nested, "file_path") ??
      (typeof args?.resourcePath === "string" ? args.resourcePath : undefined),
    input,
    op,
    command,
    offset,
    limit,
    startLine,
    endLine,
    query,
    pattern,
    depth,
    content,
    patch,
    oldString,
    newString,
    replaceAll,
    edits,
    ignore,
    url,
    jobId,
    wait,
    channelId,
    memberId,
    messageId,
    body,
    reason,
    note,
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

function getBasename(path?: string): string {
  if (!path) return "";
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index >= 0) return path.slice(index + 1);
  return path;
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
  const lowerOp = parsed.op?.toLowerCase();
  const lowerCommand = parsed.command?.toLowerCase();

  const simpleToolTitle = (label: string, detail = "") => ({
    title: `${actorLabel} · ${label}`,
    detail,
  });

  if (toolName === "agent.delegate") {
    const args = callBody?.toolCall?.args ?? {};
    const delegates = Array.isArray(args.delegates) ? args.delegates.length : 1;
    return simpleToolTitle(`delegated ${delegates} task${delegates === 1 ? "" : "s"}`);
  }

  if (toolName === "filesystem") {
    return parsed.action?.toLowerCase() === "write"
      ? simpleToolTitle("patch")
      : simpleToolTitle("read");
  }
  if (toolName === "view") {
    return simpleToolTitle("view");
  }
  if (toolName === "write") {
    return simpleToolTitle("write");
  }
  if (toolName === "edit") {
    return simpleToolTitle("edit");
  }
  if (toolName === "multiedit") {
    return simpleToolTitle("multiedit");
  }
  if (toolName === "ls") {
    return simpleToolTitle("ls");
  }
  if (toolName === "glob") {
    return simpleToolTitle("glob");
  }
  if (toolName === "fetch") {
    return simpleToolTitle("fetch");
  }
  if (toolName === "download") {
    return simpleToolTitle("download");
  }
  if (toolName === "job_output") {
    return simpleToolTitle("job output");
  }
  if (toolName === "job_kill") {
    return simpleToolTitle("job kill");
  }

  if (toolName === "shell") {
    return {
      title: `${actorLabel} · shell`,
      detail: "",
    };
  }

  if (toolName === "grep") {
    return {
      title: `${actorLabel} · grep`,
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
  const messageDetail = (label: string, body?: string) => ({
    title: `${actorLabel} ${label}`,
    detail: body?.trim() ? `${sentenceCase(label)}\n${body.trim()}` : sentenceCase(label),
  });

  if (toolName === "channel.dm") {
    return messageDetail(
      `sent a DM${parsed.memberId ? ` to ${parsed.memberId}` : ""}`,
      parsed.body,
    );
  }
  if (toolName === "channel.reply") {
    return messageDetail(
      `replied${parsed.messageId ? ` to ${parsed.messageId}` : ""}`,
      parsed.body,
    );
  }
  if (toolName === "channel.post") {
    return messageDetail(
      `posted${parsed.channelId ? ` to ${parsed.channelId}` : ""}`,
      parsed.body,
    );
  }
  if (toolName === "channel.pass") {
    return messageDetail(
      `stood down${parsed.reason ? `: ${parsed.reason}` : ""}`,
      parsed.note,
    );
  }
  if (toolName === "channel.ack") {
    return messageDetail("acknowledged", parsed.note);
  }
  if (toolName === "channel.handoff") {
    return messageDetail("handed off", parsed.body);
  }

  if (parsed.action === "write" && parsed.resourceType === "file" && path) {
    return {
      title: `${actorLabel} is writing to ${getBasename(path)}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.resourceType === "file" && path && isDeleteOp) {
    return {
      title: `${actorLabel} deleted file ${getBasename(path)}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.resourceType === "file" && path && isCreateOp) {
    return {
      title: `${actorLabel} created file ${getBasename(path)}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.resourceType === "file" && path && isReadOp) {
    return {
      title: `${actorLabel} read file ${getBasename(path)}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if ((parsed.action === "execute" || parsed.action === "write") && parsed.resourceType === "file" && path) {
    return {
      title: `${actorLabel} updated file ${getBasename(path)}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.resourceType === "folder" && path && isDeleteOp) {
    return {
      title: `${actorLabel} deleted folder ${getBasename(path)}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if (parsed.resourceType === "folder" && path && isCreateOp) {
    return {
      title: `${actorLabel} created folder ${getBasename(path)}`,
      detail: `${actorLabel} called ${toolName} ${location}.`,
    };
  }
  if ((parsed.action === "write" || parsed.action === "execute") && parsed.resourceType === "folder" && path && isUpdateOp) {
    return {
      title: `${actorLabel} updated folder ${getBasename(path)}`,
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

function runEventToStep(
  input: ReasoningTraceInput,
  event: ActivityEvent,
  run: RunState,
): TraceStepData {
  const label = RUN_STATUS_LABELS[run.status] ?? run.status;
  const status: TraceStepData["status"] =
    run.status === "failed" || run.status === "cancelled"
      ? "failed"
      : run.status === "completed"
        ? "success"
        : "running";
  const actor = resolveMember(input, run.agentId);
  return {
    id: event.event_id,
    title: `Run · ${label}`,
    detail: "",
    time: formatTimestamp(event.timestamp),
    duration: "—",
    status,
    actorId: run.agentId,
    actorName: actor.name,
    runId: run.id,
  };
}

function runChunkEventToStep(input: ReasoningTraceInput, event: ActivityEvent): TraceStepData {
  const body = event.payload as RunChunkEvent | undefined;
  const actorId = body?.agentId ?? event.publisher;
  const actor = resolveMember(input, actorId);
  const label = body?.kind === "reasoning" ? "reasoning" : "text";
  return {
    id: event.event_id,
    title: `${actor.name} · ${label}`,
    detail: body?.delta ?? "",
    time: formatTimestamp(event.timestamp),
    duration: "—",
    status: "running",
    actorId,
    actorName: actor.name,
    ...(body?.runId ? { runId: body.runId } : {}),
  };
}

const runChunkKey = runChunkActivityKey;

function mergeRunChunkStep(step: TraceStepData, event: ActivityEvent): TraceStepData {
  const body = event.payload as RunChunkEvent | undefined;
  return {
    ...step,
    id: `${step.id}:${event.event_id}`,
    detail: appendRunChunkDetail(step.detail, body?.delta ?? ""),
    time: formatTimestamp(event.timestamp),
  };
}

function appendRunChunkDetail(current: string, delta: string): string {
  const next = `${current}${delta}`;
  if (next.length <= MAX_RUN_CHUNK_DETAIL_CHARS) return next;
  return `…${next.slice(-(MAX_RUN_CHUNK_DETAIL_CHARS - 1))}`;
}

function formatHumanFriendlyObject(obj: unknown, indent = ""): string {
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "None";
    return obj
      .map((item) => {
        if (typeof item === "object") {
          return `${indent}-\n${formatHumanFriendlyObject(item, indent + "  ")}`;
        }
        return `${indent}- ${String(item)}`;
      })
      .join("\n");
  }

  const record = obj as Record<string, unknown>;
  const lines: string[] = [];
  for (const [key, val] of Object.entries(record)) {
    if (val === null || val === undefined) continue;

    // Convert snake_case or camelCase key to Sentence Case
    const label = key
      .replace(/([A-Z])/g, " $1")
      .replace(/[_-]/g, " ")
      .trim()
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

    if (typeof val === "object") {
      const formattedVal = formatHumanFriendlyObject(val, indent + "  ");
      if (formattedVal.trim()) {
        lines.push(`${indent}${label}:\n${formattedVal}`);
      }
    } else {
      lines.push(`${indent}${label}: ${String(val)}`);
    }
  }
  return lines.join("\n");
}

function formatStructuredToolDetail(
  name: string,
  args: unknown,
  result: unknown,
  narrativeDetail?: string,
): string {
  const parts: string[] = [];

  const cleanVal = (val: unknown): string => {
    if (val === undefined || val === null) return "";
    if (typeof val === "object") {
      try {
        return typeof (val as { content?: string })?.content === "string"
          ? (val as { content: string }).content
          : JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    return String(val);
  };

  const argsRecord = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const resultRecord = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const nestedInput = argsRecord.input && typeof argsRecord.input === "object"
    ? (argsRecord.input as Record<string, unknown>)
    : argsRecord;
  if (
    name === "channel.dm" ||
    name === "channel.reply" ||
    name === "channel.post" ||
    name === "channel.pass" ||
    name === "channel.ack" ||
    name === "channel.handoff"
  ) {
    return narrativeDetail || `${name} executed.`;
  }

  if (name.includes("memory.write")) {
    const value = nestedInput.value ?? nestedInput.content;
    if (value) {
      parts.push(cleanVal(value));
    }
  } else if (name.includes("memory.recall")) {
    const query = nestedInput.query ?? nestedInput.key_prefix;
    if (query) {
      parts.push(`Query: "${cleanVal(query)}"`);
    }

    const entries = resultRecord.entries;
    if (Array.isArray(entries) && entries.length > 0) {
      const entryParts: string[] = [];
      for (const entry of entries) {
        if (entry && typeof entry === "object") {
          const entryVal = entry.value ?? entry.content;
          if (entryVal) {
            entryParts.push(cleanVal(entryVal));
          }
        }
      }
      if (entryParts.length > 0) {
        if (entryParts.length === 1) {
          parts.push(`Recalled:\n${entryParts[0]}`);
        } else {
          parts.push(`Recalled:\n${entryParts.map(val => `- ${val}`).join("\n")}`);
        }
      } else {
        parts.push("No matching memories found.");
      }
    } else {
      parts.push("No matching memories found.");
    }
  } else if (name.includes("memory.forget")) {
    const key = nestedInput.key;
    if (key) {
      parts.push(`Forgot memory: ${cleanVal(key)}`);
    }
  } else if (name.startsWith("self.procedure.add")) {
    const procName = nestedInput.name;
    const steps = nestedInput.steps ?? nestedInput.description ?? nestedInput.content;
    if (procName) {
      parts.push(`Procedure: ${cleanVal(procName)}`);
    }
    if (steps) {
      parts.push(`Steps:\n${cleanVal(steps)}`);
    }
  } else if (name.startsWith("self.procedure.remove")) {
    const procName = nestedInput.name;
    if (procName) {
      parts.push(`Removed procedure: ${cleanVal(procName)}`);
    }
  } else if (name === "goal.start") {
    const title = nestedInput.title;
    const plan = nestedInput.plan_markdown ?? nestedInput.planMarkdown;
    if (title) {
      parts.push(`Title: ${cleanVal(title)}`);
    }
    if (plan) {
      parts.push(`Plan:\n${cleanVal(plan)}`);
    }
  } else if (name === "question.ask") {
    const text = nestedInput.question_text ?? nestedInput.questionText;
    const options = nestedInput.options;
    if (text) {
      parts.push(`Question: ${cleanVal(text)}`);
    }
    if (Array.isArray(options) && options.length > 0) {
      parts.push(`Options:\n${options.map(opt => `- ${cleanVal(opt)}`).join("\n")}`);
    }
  } else if (name === "goal.task.update") {
    const status = nestedInput.status;
    const summary = nestedInput.handover_summary ?? nestedInput.handoverSummary;
    if (status) {
      parts.push(`Updated status to: ${cleanVal(status)}`);
    }
    if (summary) {
      parts.push(`Handover Summary:\n${cleanVal(summary)}`);
    }
  } else if (name === "schedule") {
    const action = cleanVal(nestedInput.action);
    const job = resultRecord.job && typeof resultRecord.job === "object"
      ? resultRecord.job as Record<string, unknown>
      : undefined;
    const jobs = Array.isArray(resultRecord.jobs) ? resultRecord.jobs : [];
    if (action === "create") {
      parts.push("Schedule created");
    } else if (action === "cancel") {
      parts.push(resultRecord.removed === false ? "Schedule not found" : "Schedule cancelled");
    } else if (action === "list") {
      parts.push(`Schedules listed: ${jobs.length}`);
    } else {
      parts.push("Schedule updated");
    }
    const nameVal = nestedInput.name ?? job?.name;
    const cron = nestedInput.cron_expression ?? nestedInput.cronExpression ?? job?.cronExpression;
    const prompt = nestedInput.prompt ?? job?.prompt;
    const nextRun = job?.nextRunAt;
    const status = job?.status;
    if (nameVal) parts.push(`Name: ${cleanVal(nameVal)}`);
    if (cron) parts.push(`Cron: ${cleanVal(cron)}`);
    if (status) parts.push(`Status: ${cleanVal(status)}`);
    if (nextRun) parts.push(`Next run: ${cleanVal(nextRun)}`);
    if (prompt) parts.push(`Prompt:\n${cleanVal(prompt)}`);
    if (jobs.length > 0) {
      parts.push(`Jobs:\n${jobs.map((item) => {
        const rec = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return `- ${cleanVal(rec.name ?? "Schedule")} (${cleanVal(rec.cronExpression ?? "")})`;
      }).join("\n")}`);
    }
  } else if (name === "agent.delegate") {
    const details = Array.isArray(resultRecord.details) ? resultRecord.details : [];
    if (details.length > 0) {
      parts.push(`Delegated ${details.length} task${details.length === 1 ? "" : "s"}`);
      for (const [index, detail] of details.entries()) {
        const rec = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
        const label = rec.delegate_index ?? index;
        const agent = rec.agent ? ` to ${cleanVal(rec.agent)}` : "";
        const status = rec.status ? ` - ${cleanVal(rec.status)}` : "";
        const reply = rec.reply_content ? `\n  ${cleanVal(rec.reply_content)}` : "";
        const thread = rec.thread_id ? `\n  Thread: ${cleanVal(rec.thread_id)}` : "";
        parts.push(`#${label}${agent}${status}${reply}${thread}`);
      }
    } else {
      const delegates = Array.isArray(nestedInput.delegates) ? nestedInput.delegates.length : 1;
      parts.push(`Delegated ${delegates} task${delegates === 1 ? "" : "s"}`);
    }
  } else if (name.includes("channel") || name.includes("slack") || name.includes("message")) {
    const message = nestedInput.message ?? nestedInput.content ?? nestedInput.text ?? nestedInput.body;
    if (message) {
      parts.push(cleanVal(message));
    }
  } else {
    const textVal =
      nestedInput.value ??
      nestedInput.content ??
      nestedInput.text ??
      nestedInput.body ??
      nestedInput.message;

    if (textVal) {
      parts.push(cleanVal(textVal));
    } else {
      const filteredInput = { ...nestedInput };
      delete filteredInput.bypassPermission;
      delete filteredInput.resourceType;
      delete filteredInput.action;

      const formattedInput = formatHumanFriendlyObject(filteredInput);
      if (formattedInput.trim()) {
        parts.push(`Arguments:\n${formattedInput}`);
      }
    }

    const outputVal = resultRecord.result ?? resultRecord.output ?? result;
    if (outputVal !== undefined && outputVal !== null) {
      if (typeof outputVal === "object") {
        const recObj = outputVal as Record<string, unknown>;
        const mainText = recObj.content ?? recObj.stdout ?? recObj.output ?? recObj.result;
        if (typeof mainText === "string" && mainText.trim()) {
          parts.push(mainText.trim());
        } else {
          const formattedOutput = formatHumanFriendlyObject(outputVal);
          if (formattedOutput.trim()) {
            parts.push(`Result:\n${formattedOutput}`);
          }
        }
      } else if (String(outputVal).trim() !== "Saved.") {
        parts.push(String(outputVal));
      }
    }
  }

  if (parts.length === 0) {
    return narrativeDetail || `${name} executed.`;
  }

  return parts.join("\n\n");
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
  const parsed = inferToolAction(
    mergedPayload?.toolCall?.args as Record<string, unknown> | undefined,
  );
  const isError = resultBody?.toolResult?.isError === true;
  const errorText = extractToolErrorText(resultBody?.toolResult?.result);
  const hasResult = !!result;
  const resultOutput = hasResult
    ? toolAggregateOutput(name, resultBody?.toolResult?.result, isError, errorText)
    : "";

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

  const line = deriveToolLine(input, call ?? result, mergedPayload);

  let terminal: TraceStepData["terminal"] | undefined;
  if (name === "shell") {
    const shellArgs = parseShellToolCallArgs(mergedPayload?.toolCall?.args as Record<string, unknown> | undefined);
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
        terminal = {
          cwd: shellArgs.cwd,
          commandLine: cmdLine,
          output: resultOutput,
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
  if (name === "fetch") {
    const url = parsed.url ?? "";
    const origin = (() => {
      if (!url) return ".";
      try {
        return new URL(url).origin;
      } catch {
        return ".";
      }
    })();
    terminal = {
      cwd: origin,
      commandLine: url ? `fetch ${url}` : "fetch",
      output: hasResult ? resultOutput : undefined,
      outputTone: isError ? "error" : "default",
    };
  }
  if (name === "job_output") {
    const snapshot = toObject(resultBody?.toolResult?.result);
    const jobId = parsed.jobId;
    const runId = mergedPayload?.runId;
    const orgId =
      typeof mergedPayload?.organizationId === "string"
        ? mergedPayload.organizationId
        : input.organizationId;
    if (snapshot?.status === "running" && !resultOutput && jobId && runId && orgId) {
      terminal = {
        cwd: typeof snapshot.cwd === "string" ? snapshot.cwd : ".",
        commandLine:
          typeof snapshot.commandLine === "string" && snapshot.commandLine.trim()
            ? snapshot.commandLine
            : `job_output ${jobId}`,
        streamingJob: { runId, jobId, organizationId: orgId },
      };
    } else if (hasResult) {
      terminal = {
        cwd: typeof snapshot?.cwd === "string" ? snapshot.cwd : ".",
        commandLine:
          typeof snapshot?.commandLine === "string" && snapshot.commandLine.trim()
            ? snapshot.commandLine
            : `job_output ${jobId ?? ""}`.trim(),
        output: resultOutput,
        outputTone: isError ? "error" : "default",
      };
    }
  }

  let filesystem: TraceStepData["filesystem"] | undefined;
  if (name === "filesystem") {
    const fsArgs = parseFilesystemToolCallArgs(
      mergedPayload?.toolCall?.args as Record<string, unknown> | undefined,
    );
    if (fsArgs) {
      const fromRaw = extractContentFromResult(resultBody?.toolResult?.result);
      const bodyFromResult = fromRaw || (resultOutput.trim() ? resultOutput : undefined);
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
            ? (parsed.startLine !== undefined && parsed.endLine !== undefined
                ? `[startLine=${parsed.startLine}, endLine=${parsed.endLine}]`
                : `[offset=${fsArgs.offset ?? 1}, limit=${fsArgs.limit ?? 20}]`)
            : undefined,
        body: resolved !== undefined && resolved.length > 0 ? resolved : undefined,
        bodyTone: isError ? "error" : "default",
      };
    }
  }
  if (name === "view" || name === "read" || name === "write" || name === "edit" || name === "multiedit" || name === "ls" || name === "glob" || name === "download") {
    const fromRaw = extractContentFromResult(resultBody?.toolResult?.result);
    const bodyFromResult = fromRaw || resultOutput;
    const pendingBody =
      !hasResult || pendingCompletion
        ? name === "write"
          ? parsed.resourcePath && parsed.content !== undefined
            ? proposedWriteDiff(parsed.resourcePath, parsed.content)
            : argsPreview
          : name === "edit"
            ? parsed.resourcePath && parsed.oldString !== undefined && parsed.newString !== undefined
              ? proposedEditDiff(parsed.resourcePath, parsed.oldString, parsed.newString)
              : argsPreview
            : name === "multiedit"
              ? proposedMultiEditDiff(parsed.resourcePath, parsed.edits) ?? argsPreview
              : name === "view"
                ? argsPreview
                : name === "ls"
                  ? argsPreview
                  : name === "glob"
                    ? parsed.pattern ?? argsPreview
                    : name === "download"
                      ? parsed.url ?? argsPreview
                      : undefined
        : undefined;
    const resolved = bodyFromResult || pendingBody;
    filesystem = {
      action: name === "write" || name === "edit" || name === "multiedit" || name === "download" ? "write" : "read",
      resourcePath: parsed.resourcePath ?? "",
        meta:
          name === "view" || name === "read"
          ? (parsed.startLine !== undefined && parsed.endLine !== undefined
              ? `[startLine=${parsed.startLine}, endLine=${parsed.endLine}]`
              : `[offset=${parsed.offset ?? 1}, limit=${parsed.limit ?? 1000}]`)
          : name === "ls"
            ? `[depth=${parsed.depth ?? 0}, limit=${parsed.limit ?? 1000}]`
            : name === "glob"
              ? parsed.pattern
                ? `[pattern=${parsed.pattern}]`
                : undefined
              : name === "download"
                ? parsed.url
                  ? `[url=${parsed.url}]`
                  : undefined
                : undefined,
      body: resolved !== undefined && resolved.length > 0 ? resolved : undefined,
      bodyTone: isError ? "error" : "default",
    };
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

  let skillRead: TraceStepData["skillRead"] | undefined;
  if (name === "skill.read") {
    const args = mergedPayload?.toolCall?.args as Record<string, unknown> | undefined;
    const skillName = typeof args?.name === "string" ? args.name : "skill";
    const pluginName = typeof args?.plugin === "string" ? args.plugin : undefined;
    const description = typeof args?.description === "string" ? args.description : undefined;
    const rawOutput = resultBody?.toolResult?.result;
    const outputStr =
      typeof rawOutput === "string"
        ? rawOutput
        : rawOutput != null
          ? JSON.stringify(rawOutput)
          : undefined;
    skillRead = { skillName, pluginName, description, output: outputStr };
  }

  const hasRich = !!(terminal || filesystem || grep || webSearch || skillRead);

  const actorId = mergedPayload?.agentId ?? call?.publisher ?? result?.publisher;
  if (!actorId) {
    throw new Error(`buildToolStep: tool ${toolCallId} has no actor (missing call/result publisher and payload.agentId)`);
  }
  const actor = resolveMember(input, actorId);
  const runId = mergedPayload?.runId;

  return {
    id: `tool:${toolCallId}:${call?.event_id ?? ""}:${result?.event_id ?? ""}`,
    title: line.title,
    toolName: name,
    detail: hasRich
      ? ""
      : formatStructuredToolDetail(
          name,
          mergedPayload?.toolCall?.args,
          resultBody?.toolResult?.result,
          line.detail,
        ),
    time: formatTimestamp(ts),
    duration,
    status,
    terminal,
    filesystem,
    grep,
    webSearch,
    skillRead,
    actorId,
    actorName: actor.name,
    ...(runId ? { runId } : {}),
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
  const content = body.content ?? "";
  const reasoning = body.reasoning ?? "";
  const runId = body.runId ?? event.task_id;
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
    detail: content.trim() ? content : "",
    ...(reasoning.trim() ? { reasoning } : {}),
    time: formatTimestamp(event.timestamp),
    duration: "—",
    status: "success",
    actorId: event.publisher,
    actorName: actor.name,
    ...(runId ? { runId } : {}),
  };
}

interface OrderedStep {
  sortIndex: number;
  step: TraceStepData;
  chunkKey?: string;
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

export function buildReasoningTraceSteps(input: ReasoningTraceInput): TraceStepData[] {
  const runIdsForThread = collectRunIdsForThread({
    ...input,
    activity: collapseRunChunkActivities(input.activity),
  });
  const { threadId, agentIdFilter } = input;
  const activity = collapseRunChunkActivities(input.activity);

  const filtered = activity.filter((event) => {
    if (!TRACE_ACTIVITY_TYPES.has(event.type)) return false;

    if (RUN_ACTIVITY_TYPES.has(event.type)) {
      const run = event.payload as RunState | undefined;
      if (!run?.id || run.threadId !== threadId) return false;
      if (agentIdFilter && run.agentId !== agentIdFilter) return false;
      return true;
    }

    if (event.type === "run_chunk") {
      const chunk = event.payload as RunChunkEvent | undefined;
      if (!chunk?.runId || chunk.threadId !== threadId) return false;
      if (agentIdFilter && chunk.agentId !== agentIdFilter) return false;
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

  const sorted = filtered.slice().sort(compareActivityEvents);

  const toolMerge = new Map<string, { call?: ActivityEvent; result?: ActivityEvent }>();
  const toolSortIndex = new Map<string, number>();
  const ordered: OrderedStep[] = [];

  sorted.forEach((event, index) => {
    if (event.type === "tool_called") {
      const id = toolCallIdFromPayload(event, "tool_called");
      if (!toolSortIndex.has(id)) toolSortIndex.set(id, index);
      const slot = toolMerge.get(id) ?? {};
      slot.call = event;
      toolMerge.set(id, slot);
      return;
    }
    if (event.type === "tool_result") {
      const id = toolCallIdFromPayload(event, "tool_result");
      if (!toolSortIndex.has(id)) toolSortIndex.set(id, index);
      const slot = toolMerge.get(id) ?? {};
      slot.result = event;
      toolMerge.set(id, slot);
      return;
    }
    if (RUN_ACTIVITY_TYPES.has(event.type)) {
      ordered.push({
        sortIndex: index,
        step: runEventToStep(input, event, event.payload as RunState),
      });
      return;
    }
    if (event.type === "run_chunk") {
      const chunkKey = runChunkKey(event);
      const previous = ordered[ordered.length - 1];
      if (chunkKey && previous?.chunkKey === chunkKey && previous.sortIndex === index - 1) {
        previous.step = mergeRunChunkStep(previous.step, event);
        previous.sortIndex = index;
        return;
      }
      ordered.push({
        sortIndex: index,
        step: runChunkEventToStep(input, event),
        chunkKey,
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
      sortIndex: toolSortIndex.get(toolCallId) ?? maxIndex,
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
      context,
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
    for (const item of persistedMessageChunks(input.message)) {
      steps.push(runChunkEventToStep(context, item));
    }
  }

  return steps;
}

function persistedMessageChunks(message: Message): ActivityEvent[] {
  const runId = message.metadata?.runId;
  if (!runId) return [];

  const base = {
    publisher: message.senderId,
    timestamp: message.createdAt,
    task_id: runId,
  };
  return [
    { kind: "reasoning", delta: message.reasoningContent?.trim() ?? "" },
    { kind: "text", delta: message.content.trim() },
  ].flatMap(({ kind, delta }) =>
    delta
      ? [{
          ...base,
          event_id: `message:${message.id}:${kind}`,
          type: "run_chunk",
          payload: {
            runId,
            threadId: message.threadId,
            agentId: message.senderId,
            kind,
            delta,
          },
        }]
      : [],
  );
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
