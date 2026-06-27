import type { ActivityEvent, RunState } from "@ujima/shared/browser";

const LIVE_RUN_STATUSES = new Set(["queued", "running", "waiting_for_approval", "waiting_for_input"]);

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function eventRunId(event: ActivityEvent): string | undefined {
  const payload = objectValue(event.payload);
  const run = objectValue(payload?.run);
  const approval = objectValue(payload?.approval);
  return event.task_id ?? stringValue(payload?.runId) ?? stringValue(run?.id) ?? stringValue(approval?.runId);
}

function cleanText(value: unknown): string | undefined {
  const text = stringValue(value)?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function toolName(payload: Record<string, unknown> | undefined): string | undefined {
  return stringValue(objectValue(payload?.toolCall)?.toolName);
}

function toolCallId(payload: Record<string, unknown> | undefined): string | undefined {
  return stringValue(objectValue(payload?.toolCall)?.toolCallId) ?? stringValue(objectValue(payload?.toolResult)?.toolCallId);
}

function findToolName(activity: readonly ActivityEvent[], runId: string, callId: string | undefined, before: number): string | undefined {
  if (!callId) return undefined;
  for (let i = before; i >= 0; i -= 1) {
    const event = activity[i];
    if (event.type !== "tool_called" || eventRunId(event) !== runId) continue;
    const payload = objectValue(event.payload);
    if (toolCallId(payload) === callId) return toolName(payload);
  }
  return undefined;
}

function runFallback(run: RunState): string {
  if (run.status === "waiting_for_approval") return "Waiting for approval";
  if (run.status === "waiting_for_input") return "Waiting for input";
  if (run.status === "queued") return "Queued";
  return cleanText(run.step) ? `Working: ${cleanText(run.step)}` : "Working";
}

function textForEvent(event: ActivityEvent, activity: readonly ActivityEvent[], index: number, runId: string): string | undefined {
  const payload = objectValue(event.payload);
  if (event.type === "run_chunk") {
    const label = payload?.kind === "reasoning" ? "Thinking" : "Writing";
    const delta = cleanText(payload?.delta);
    return delta ? `${label}: ${delta}` : label;
  }
  if (event.type === "tool_called") {
    return toolName(payload) ? `Using ${toolName(payload)}` : "Using a tool";
  }
  if (event.type === "tool_result") {
    const result = objectValue(objectValue(payload?.toolResult)?.result);
    if (result?.status === "waiting_for_approval") return "Approval required";
    if (objectValue(payload?.toolResult)?.isError === true) return "Tool blocked";
    const name = findToolName(activity, runId, toolCallId(payload), index);
    return name ? `${name} finished` : "Tool finished";
  }
  if (event.type === "approval_requested") return "Approval required";
  return undefined;
}

export function liveActivityTextForRun(run: RunState, activity: readonly ActivityEvent[]): string {
  for (let i = activity.length - 1; i >= 0; i -= 1) {
    const event = activity[i];
    if (eventRunId(event) !== run.id) continue;
    return textForEvent(event, activity, i, run.id) ?? runFallback(run);
  }
  return runFallback(run);
}

export function liveActivityTextForRuns(runs: readonly RunState[], activity: readonly ActivityEvent[]): string | undefined {
  let selected: RunState | undefined;
  for (const run of runs) {
    if (!LIVE_RUN_STATUSES.has(run.status)) continue;
    if (!selected || Date.parse(run.startedAt) > Date.parse(selected.startedAt)) selected = run;
  }
  return selected ? liveActivityTextForRun(selected, activity) : undefined;
}
