import type { ActivityEvent, RunState } from "@ujima/shared/browser";
import type { ChatMessageData } from "./components/chat";

export function isLiveRun(run: RunState): boolean {
  return run.status === "queued" || run.status === "running" || run.status === "waiting_for_approval";
}

export function buildTabCounts(input: {
  activity: ActivityEvent[];
  approvals: { status: string }[];
  messages: ChatMessageData[];
  runs: RunState[];
}) {
  return {
    approvals: input.approvals.filter((approval) => approval.status === "pending").length,
    tasks: input.runs.filter(isLiveRun).length,
    activity: input.activity.length,
    files: input.messages.reduce((count, message) => count + (message.attachments?.length ?? 0), 0),
  };
}

export function collectConversationAttachments(messages: ChatMessageData[]) {
  return messages.flatMap((message) =>
    (message.attachments ?? []).map((attachment) => ({
      ...attachment,
      messageName: message.name,
      messageTime: message.time,
      messageId: message.id,
    })),
  );
}

export function collectBlockedRunReasons(activity: ActivityEvent[]): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const event of activity) {
    if (event.type !== "tool_result") continue;
    const body = event.payload as {
      runId?: string;
      toolResult?: { isError?: boolean; result?: unknown };
    };
    if (!body.runId || !body.toolResult?.isError) continue;
    const reason = toolErrorText(body.toolResult.result);
    if (!reason || reasons.has(body.runId)) continue;
    reasons.set(body.runId, reason);
  }
  return reasons;
}

function toolErrorText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return undefined;
  const record = result as { error?: unknown; reason?: unknown };
  if (typeof record.error === "string") return record.error;
  if (typeof record.reason === "string") return record.reason;
  return undefined;
}
