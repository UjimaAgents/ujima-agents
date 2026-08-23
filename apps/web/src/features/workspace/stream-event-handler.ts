import {
  ApprovalRequestSchema,
  MemberSchema,
  MessageSchema,
  RunChunkEventSchema,
  RunStateSchema,
  RunTokenUsageEventSchema,
  buildMentionHandleRegistry,
  scanMentionsInContent,
  type ActivityEvent,
  type ApprovalRequest,
  type Member,
  type Message,
  type RunChunkEvent,
  type RunState,
  type RunTokenUsageEvent,
} from "@ujima/shared/browser";
import type { ApprovalCardData, ChatMessageData } from "./components/chat";
import type { ConversationMessageMetadata, ConversationStreamEnvelope } from "./conversation-transport";
import {
  presenceToActivityState,
  runStatusToActivityState,
  type ActivityState,
} from "./activity-state";
import { approvalToCard } from "./approval-card-data";
import {
  approvalToActivity,
  memberAlertedToActivity,
  memberAlertFailedToActivity,
  memberToActivity,
  messageToActivity,
  presenceToActivity,
  runToActivity,
  socketEventToActivity,
  toolToActivity,
  type MemberAlertFailedPayload,
  type MemberAlertedPayload,
} from "./activity-events";
import { formatTimestamp } from "./lib/format-timestamp";

export interface StreamEventActions {
  appendActivity(event: ActivityEvent): void;
  appendMember(member: Member): void;
  appendRunChunk(chunk: RunChunkEvent, expectedConversationKey: string): void;
  flushRunChunks(expectedConversationKey: string): void;
  receiveMessage(
    tempId: string | undefined,
    message: Message,
    toMessage: (message: Message) => ChatMessageData,
    toActivity: (message: Message) => ActivityEvent,
    expectedConversationKey?: string,
  ): void;
  removeMessage(id: string): void;
  setConversationError(message: string | undefined): void;
  setLoading(loading: boolean): void;
  setMemberActivity(memberId: string, activity: ActivityState): void;
  storeMembers: Member[];
  expectedConversationKey: string;
  upsertApproval(
    approval: ApprovalRequest,
    toCard: (approval: ApprovalRequest, state: { members: Member[] }) => ApprovalCardData,
    toActivity: (approval: ApprovalRequest) => ActivityEvent,
  ): void;
  upsertRun(run: RunState, toActivity: (run: RunState) => ActivityEvent): void;
  setRunTokens(runId: string, inputTokens: number, outputTokens: number): void;
}

export function handleStreamEvent(
  envelope: Exclude<ConversationStreamEnvelope, { type: "ready" } | { type: "error" }>,
  actions: StreamEventActions,
): void {
  if (envelope.type !== "socket") return;
  if (envelope.event !== "run:chunk") {
    actions.flushRunChunks(actions.expectedConversationKey);
  }

  switch (envelope.event) {
    case "channel:message":
    case "thread:message":
    case "dm:message": {
      const message = parseMessagePayload(envelope.payload);
      if (!message) return;
      actions.receiveMessage(undefined, message, (value) => messageToChatMessage(value, actions.storeMembers), messageToActivity, actions.expectedConversationKey);
      if (message.senderKind === "agent") {
        actions.setConversationError(undefined);
      }
      return;
    }
    case "approval:requested":
    case "approval:resolved": {
      const approval = parseApprovalPayload(envelope.payload);
      if (!approval) return;
      actions.upsertApproval(
        approval,
        (value, state) => approvalToCard(value, { members: state.members }),
        approvalToActivity,
      );
      return;
    }
    case "run:started":
    case "run:updated":
    case "run:completed": {
      const run = parseRunPayload(envelope.payload);
      if (!run) return;
      actions.upsertRun(run, runToActivity);
      if (envelope.event === "run:started") {
        actions.setConversationError(undefined);
      } else if (envelope.event === "run:completed" && run.status === "failed") {
        actions.setConversationError(run.summary || "Agent run failed.");
      }
      const member = actions.storeMembers.find((m) => m.id === run.agentId);
      const nextActivity = runStatusToActivityState(run.status, member?.presence);
      if (nextActivity) {
        actions.setMemberActivity(run.agentId, nextActivity);
      }
      return;
    }
    case "run:chunk": {
      const chunk = parseRunChunkPayload(envelope.payload);
      if (!chunk) return;
      actions.appendRunChunk(chunk, actions.expectedConversationKey);
      return;
    }
    case "run:tokens": {
      const usage = parseRunTokenUsagePayload(envelope.payload);
      if (!usage) return;
      actions.setRunTokens(usage.runId, usage.inputTokens, usage.outputTokens);
      return;
    }
    case "member.alerted": {
      const alerted = parseMemberAlertedPayload(envelope.payload);
      if (!alerted) return;
      actions.setMemberActivity(alerted.memberId, "online");
      actions.appendActivity(memberAlertedToActivity(alerted));
      return;
    }
    case "member.alert_failed": {
      const failure = parseMemberAlertFailedPayload(envelope.payload);
      if (!failure) return;
      actions.setConversationError(failure.error);
      actions.setMemberActivity(failure.memberId, "error");
      actions.appendActivity(memberAlertFailedToActivity(failure));
      return;
    }
    case "member.must_reply_failed": {
      // L7/L12 — agent was @mentioned and produced no posting tool.
      // Surface as conversation error so the human gets a visible
      // signal that the contract was violated. Detailed rendering
      // can come later; for now flagging the activity is enough.
      const body = envelope.payload as { memberId?: unknown };
      const memberId = typeof body.memberId === "string" ? body.memberId : undefined;
      if (memberId) {
        actions.setMemberActivity(memberId, "error");
      }
      actions.setConversationError("Agent was @mentioned but did not reply.");
      return;
    }
    case "member:updated": {
      const member = parseMemberPayload(envelope.payload);
      if (!member) return;
      actions.appendMember(member);
      actions.appendActivity(memberToActivity(member));
      return;
    }
    case "channel:presence": {
      const presence = parsePresencePayload(envelope.payload);
      if (presence?.memberId) {
        actions.setMemberActivity(presence.memberId, presenceToActivityState(presence.state));
      }
      actions.appendActivity(presenceToActivity(envelope.payload));
      return;
    }
    case "tool:called":
    case "tool:result": {
      actions.appendActivity(toolToActivity(envelope.event, envelope.payload));
      return;
    }
    case "agent:passed":
    case "agent:passed_with_text":
    case "agent:ack":
    case "agent:handoff":
    case "decision:verification_result":
    case "wake:suppressed":
    case "run:silent_completion":
    case "run:empty_completion":
    case "agent:mirror_suppressed":
    case "agent:echo_suppressed":
    case "supervisor:replied": {
      actions.appendActivity(socketEventToActivity(envelope.event, envelope.payload));
      return;
    }
    default:
      return;
  }
}

function parseMessagePayload(payload: unknown): Message | null {
  const parsed = MessageSchema.safeParse((payload as { message?: unknown })?.message);
  return parsed.success ? parsed.data : null;
}

function parseApprovalPayload(payload: unknown): ApprovalRequest | null {
  const parsed = ApprovalRequestSchema.safeParse((payload as { approval?: unknown })?.approval);
  return parsed.success ? parsed.data : null;
}

function parseRunChunkPayload(payload: unknown): RunChunkEvent | null {
  const parsed = RunChunkEventSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseRunTokenUsagePayload(payload: unknown): RunTokenUsageEvent | null {
  const parsed = RunTokenUsageEventSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseRunPayload(payload: unknown): RunState | null {
  const parsed = RunStateSchema.safeParse((payload as { run?: unknown })?.run);
  return parsed.success ? parsed.data : null;
}

function parseMemberPayload(payload: unknown): Member | null {
  const parsed = MemberSchema.safeParse((payload as { member?: unknown })?.member);
  return parsed.success ? parsed.data : null;
}

function parsePresencePayload(payload: unknown): { memberId?: string; state?: string } | null {
  const body = payload as { memberId?: unknown; state?: unknown };
  if (typeof body.memberId !== "string" || typeof body.state !== "string") return null;
  return { memberId: body.memberId, state: body.state };
}

function parseMemberAlertedPayload(payload: unknown): MemberAlertedPayload | null {
  const body = payload as Partial<MemberAlertedPayload>;
  if (
    typeof body.organizationId !== "string" ||
    typeof body.memberId !== "string" ||
    typeof body.messageId !== "string" ||
    typeof body.byMemberId !== "string" ||
    typeof body.reason !== "string"
  ) {
    return null;
  }
  return {
    organizationId: body.organizationId,
    memberId: body.memberId,
    channelId: body.channelId,
    threadId: body.threadId,
    messageId: body.messageId,
    byMemberId: body.byMemberId,
    reason: body.reason,
  };
}

function parseMemberAlertFailedPayload(payload: unknown): MemberAlertFailedPayload | null {
  const body = payload as Partial<MemberAlertFailedPayload>;
  if (
    typeof body.organizationId !== "string" ||
    typeof body.memberId !== "string" ||
    typeof body.messageId !== "string" ||
    typeof body.byMemberId !== "string" ||
    typeof body.reason !== "string" ||
    typeof body.stage !== "string" ||
    typeof body.error !== "string" ||
    typeof body.occurredAt !== "string"
  ) {
    return null;
  }
  if (!["supervisor_dispatch", "run_create", "run_failed"].includes(body.stage)) {
    return null;
  }
  return {
    organizationId: body.organizationId,
    memberId: body.memberId,
    channelId: body.channelId,
    threadId: body.threadId,
    messageId: body.messageId,
    byMemberId: body.byMemberId,
    reason: body.reason,
    stage: body.stage as MemberAlertFailedPayload["stage"],
    runId: body.runId,
    error: body.error,
    occurredAt: body.occurredAt,
  };
}

export function messageToChatMessage(message: Message, members: Member[]): ChatMessageData {
  const sender = members.find((member) => member.id === message.senderId);
  return {
    id: message.id,
    clientMessageId: message.clientMessageId,
    senderId: message.senderId,
    parentMessageId: message.parentMessageId,
    threadId: message.threadId,
    channelId: message.channelId,
    role: message.kind === "system" ? "system" : sender?.roleName ?? message.senderKind,
    name: message.kind === "system" ? "System" : sender?.name ?? message.senderId,
    kind: message.kind,
    time: formatTime(message.createdAt),
    content: message.content,
    createdAt: message.createdAt,
    mentionNames:
      message.mentionNames?.length
        ? message.mentionNames
        : resolveMentionNames(message.content, members),
    attachments: message.attachments?.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      category: attachment.category,
      sizeBytes: attachment.sizeBytes,
    })) ?? [],
    toolCalls: message.toolCalls,
    pending: false,
    inputTokens: message.inputTokens,
    outputTokens: message.outputTokens,
    ...(message.metadata?.taskNudge ? { taskNudge: message.metadata.taskNudge } : {}),
    ...(message.metadata?.traceOnly ? { traceOnly: true } : {}),
    ...(message.metadata?.runId ? { streamRunId: message.metadata.runId } : {}),
    ...(messageModeTag(message.metadata) ? { tag: messageModeTag(message.metadata) } : {}),
    ...(message.metadata?.delegateMarker
      ? {
          delegateMarker: {
            delegationThreadId: message.metadata.delegateMarker.delegationThreadId,
            kind: message.metadata.delegateMarker.kind,
            ...(message.metadata.delegateMarker.agentName
              ? { agentName: message.metadata.delegateMarker.agentName }
              : {}),
          },
        }
      : {}),
    ...(message.metadata?.workflowRunMarker
      ? {
          workflowRunMarker: {
            workflowRunId: message.metadata.workflowRunMarker.workflowRunId,
            workflowName: message.metadata.workflowRunMarker.workflowName,
            phase: message.metadata.workflowRunMarker.phase,
          },
        }
      : {}),
  };
}

export function messageModeTag(metadata: ConversationMessageMetadata | undefined) {
  if (metadata?.scheduleMode) return { label: "Schedule", variant: "planning" as const };
  if (metadata?.goalMode) return { label: "Goal", variant: "analysis" as const };
  return undefined;
}

function resolveMentionNames(content: string, members: Member[]): string[] {
  const registry = buildMentionHandleRegistry(
    [
      ...members.map((member) => ({ handle: member.name, value: member.name })),
      { handle: "all", value: "all" },
    ].filter((entry) => entry.handle.trim().length > 0),
  );

  scanMentionsInContent(content, registry, {
    allowAll: true,
    onAll: () => {
      registry.values.add("all");
    },
  });

  return [...registry.values];
}

function formatTime(iso: string): string {
  return formatTimestamp(iso);
}
