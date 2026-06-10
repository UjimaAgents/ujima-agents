import type {
  ActivityEvent,
  ApprovalRequest,
  Member,
  Message,
  RunChunkEvent,
  RunState,
  SocketEventName,
} from "@ujima/shared/browser";

export interface MemberAlertFailedPayload {
  organizationId: string;
  memberId: string;
  channelId?: string;
  threadId?: string;
  messageId: string;
  byMemberId: string;
  reason: string;
  stage: "supervisor_dispatch" | "run_create" | "run_failed";
  runId?: string;
  error: string;
  occurredAt: string;
}

export interface MemberAlertedPayload {
  organizationId: string;
  memberId: string;
  channelId?: string;
  threadId?: string;
  messageId: string;
  byMemberId: string;
  reason: string;
}

export function messageToActivity(message: Message): ActivityEvent {
  return {
    event_id: `message:${message.id}`,
    type: message.channelId ? "channel_message" : "thread_message",
    publisher: message.senderId,
    timestamp: message.createdAt,
    task_id: undefined,
    session_id: undefined,
    payload: {
      messageId: message.id,
      threadId: message.threadId,
      channelId: message.channelId,
      content: message.content,
      reasoning: message.reasoningContent,
    },
  };
}

export function runChunkToActivity(chunk: RunChunkEvent, sequence: number): ActivityEvent {
  return {
    event_id: `run_chunk:${chunk.runId}:${sequence}:${chunk.kind}`,
    type: "run_chunk",
    publisher: chunk.agentId,
    timestamp: new Date().toISOString(),
    order: sequence,
    task_id: chunk.runId,
    payload: chunk,
  };
}

export function approvalToActivity(approval: ApprovalRequest): ActivityEvent {
  return {
    event_id: `approval:${approval.id}:${approval.status}:${approval.resolvedAt ?? approval.createdAt}`,
    type: approval.status === "pending" ? "approval_requested" : `approval_${approval.status}`,
    publisher: approval.requestedBy,
    timestamp: approval.resolvedAt ?? approval.createdAt,
    task_id: approval.runId,
    payload: approval,
  };
}

export function runToActivity(run: RunState): ActivityEvent {
  return {
    event_id: `run:${run.id}:${run.status}:${run.step}:${run.endedAt ?? run.startedAt}`,
    type: `run_${run.status}`,
    publisher: run.agentId,
    timestamp: run.endedAt ?? run.startedAt,
    task_id: run.id,
    payload: run,
  };
}

export function toolToActivity(event: "tool:called" | "tool:result", payload: unknown): ActivityEvent {
  const body = payload as {
    runId?: string;
    agentId?: string;
    toolCall?: { toolCallId?: string };
    toolResult?: { toolCallId?: string };
  };
  const toolCallId = body.toolCall?.toolCallId ?? body.toolResult?.toolCallId ?? "unknown";
  return {
    event_id: `tool:${event}:${String(body.runId ?? "unknown")}:${toolCallId}`,
    type: event === "tool:called" ? "tool_called" : "tool_result",
    publisher: String(body.agentId ?? "unknown"),
    timestamp: new Date().toISOString(),
    task_id: body.runId,
    payload,
  };
}

export function socketEventToActivity(event: SocketEventName, payload: unknown): ActivityEvent {
  const body = toRecord(payload);
  const message = toRecord(body.message);
  const timestamp =
    stringField(body, "occurredAt") ??
    stringField(message, "createdAt") ??
    new Date().toISOString();
  const publisher =
    stringField(body, "memberId") ??
    stringField(body, "agentId") ??
    stringField(body, "fromMemberId") ??
    stringField(body, "byMemberId") ??
    stringField(body, "toMemberId") ??
    stringField(message, "senderId") ??
    "system";
  const taskId = stringField(body, "runId") ?? stringField(body, "taskSessionId");
  const key =
    [
      stringField(body, "runId"),
      stringField(body, "messageId"),
      stringField(body, "taskSessionId"),
      stringField(body, "threadId"),
      stringField(body, "channelId"),
      stringField(body, "memberId"),
      stringField(body, "agentId"),
      stringField(body, "fromMemberId"),
      stringField(body, "byMemberId"),
      stringField(body, "toMemberId"),
      stringField(message, "id"),
      timestamp,
    ]
      .filter(Boolean)
      .join(":") || "unknown";
  return {
    event_id: `${event}:${key}`,
    type: event.replaceAll(":", "_"),
    publisher,
    timestamp,
    ...(taskId ? { task_id: taskId } : {}),
    payload,
  };
}

export function presenceToActivity(payload: unknown): ActivityEvent {
  const body = payload as { memberId?: string; state?: string };
  return {
    event_id: `presence:${String(body.memberId ?? "unknown")}:${String(body.state ?? "unknown")}:${Date.now()}`,
    type: "channel_presence",
    publisher: String(body.memberId ?? "unknown"),
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function memberToActivity(member: Member): ActivityEvent {
  return {
    event_id: `member:${member.id}:${member.presence ?? "unknown"}:${member.createdAt ?? Date.now()}`,
    type: "member_updated",
    publisher: member.id,
    timestamp: member.createdAt ?? new Date().toISOString(),
    payload: member,
  };
}

export function memberAlertedToActivity(payload: MemberAlertedPayload): ActivityEvent {
  return {
    event_id: `member-alerted:${payload.memberId}:${payload.messageId}:${payload.reason}`,
    type: "member_alerted",
    publisher: payload.memberId,
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function memberAlertFailedToActivity(payload: MemberAlertFailedPayload): ActivityEvent {
  return {
    event_id: `member-alert-failed:${payload.memberId}:${payload.messageId}:${payload.stage}:${payload.occurredAt}`,
    type: "member_alert_failed",
    publisher: payload.memberId,
    timestamp: payload.occurredAt,
    task_id: payload.runId,
    payload,
  };
}

export function describeActivity(event: Pick<ActivityEvent, "type" | "publisher" | "task_id" | "payload">): {
  title: string;
  detail: string;
} {
  const body = toRecord(event.payload);
  if (event.type.startsWith("approval_")) {
    const approval = toRecord(event.payload);
    const status = event.type === "approval_requested" ? "Approval requested" : `Approval ${String(approval.status ?? "").trim() || "updated"}`;
    return { title: status, detail: compactDetail(event.publisher, approval.action, approval.resourcePath) };
  }
  if (event.type.startsWith("run_")) {
    const run = toRecord(event.payload);
    return {
      title: run.status === "waiting_for_approval" ? "Run waiting for approval" : `Run ${String(run.status ?? event.type.slice(4))}`,
      detail: compactDetail(event.publisher, run.summary, event.task_id),
    };
  }
  if (event.type === "tool_called") {
    const toolCall = toRecord(body.toolCall);
    return { title: `Tool called: ${String(toolCall.toolName ?? "unknown")}`, detail: compactDetail(event.publisher, toolCall.args, event.task_id) };
  }
  if (event.type === "tool_result") {
    const result = toRecord(body.toolResult);
    const failed = result.isError === true;
    return {
      title: failed ? "Tool failed" : "Tool finished",
      detail: compactDetail(event.publisher, toRecord(result.result).error ?? result.result, event.task_id),
    };
  }
  if (event.type === "member_alert_failed") {
    return { title: "Agent alert failed", detail: compactDetail(event.publisher, body.error, body.reason) };
  }
  return { title: event.type.replaceAll("_", " "), detail: compactDetail(event.publisher, event.task_id) };
}

function compactDetail(...parts: unknown[]): string {
  const text = parts
    .flatMap((part) => {
      if (part === undefined || part === null || part === "") return [];
      if (typeof part === "string") return [part];
      return [JSON.stringify(part)];
    })
    .join(" · ");
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
