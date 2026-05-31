import type { ActivityEvent, RunState } from "@ujima/shared/browser";
import type { ChatMessageData } from "./components/chat";

export function isLiveRun(run: RunState): boolean {
  return (
    run.status === "queued" ||
    run.status === "running" ||
    run.status === "waiting_for_approval" ||
    run.status === "waiting_for_input"
  );
}

export function buildTabCounts(input: {
  activity: ActivityEvent[];
  approvals: { status: string }[];
  messages: ChatMessageData[];
  runs: RunState[];
}) {
  let approvals = 0;
  let tasks = 0;
  let files = 0;
  for (const approval of input.approvals) {
    if (approval.status === "pending") approvals += 1;
  }
  for (const run of input.runs) {
    if (isLiveRun(run)) tasks += 1;
  }
  for (const message of input.messages) {
    files += message.attachments?.length ?? 0;
  }
  return {
    approvals,
    tasks,
    activity: input.activity.length,
    files,
  };
}

export function collectConversationAttachments(messages: ChatMessageData[]) {
  const attachments: {
    id: string;
    filename: string;
    mimeType: string;
    category: NonNullable<ChatMessageData["attachments"]>[number]["category"];
    sizeBytes: number;
    messageName: string;
    messageTime: string;
    messageId: string;
  }[] = [];
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      attachments.push({
        ...attachment,
        messageName: message.name,
        messageTime: message.time,
        messageId: message.id,
      });
    }
  }
  return attachments;
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
