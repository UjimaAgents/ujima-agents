"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApprovalRequestSchema,
  MemberSchema,
  MessageSchema,
  RunStateSchema,
  type ActivityEvent,
  type ApprovalRequest,
  type Member,
  type Message,
  type RunState,
} from "@ujima/shared";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { ApprovalCardData, ChatMessageData } from "./components/chat";
import type { SelectedConversation } from "./types";
import {
  buildConversationMessagePayload,
  buildConversationStreamParams,
  resolveConversationTransport,
  type ConversationStreamEnvelope,
} from "./conversation-transport";
import { activityStateToStatus, conversationActivityState, presenceToActivityState, type ActivityState } from "./activity-state";
import { useWorkspaceStore } from "./workspace-store";

export interface ConversationSyncResult {
  messages: ChatMessageData[];
  approvals: ApprovalCardData[];
  runs: RunState[];
  activity: ActivityEvent[];
  selectedMember?: Member;
  status: {
    variant: "active" | "idle" | "offline" | "error";
    label: string;
  };
  loading: boolean;
  error?: string;
  sendMessage(content: string): Promise<void>;
}

export function useConversationSync(
  bootstrap: BootstrapResponse,
  conversation: SelectedConversation,
): ConversationSyncResult {
  const transport = useMemo(() => resolveConversationTransport(bootstrap, conversation), [
    bootstrap,
    conversation,
  ]);
  const conversationKey = transport ? `${transport.organizationId}:${transport.threadId}` : undefined;
  const messages = useWorkspaceStore((state) => state.messages);
  const approvals = useWorkspaceStore((state) => state.approvals);
  const runs = useWorkspaceStore((state) => state.runs);
  const activity = useWorkspaceStore((state) => state.activity);
  const loading = useWorkspaceStore((state) => state.loading);
  const storeMembers = useWorkspaceStore((state) => state.members);
  const memberActivity = useWorkspaceStore((state) => state.memberActivity);
  const resetConversationFeed = useWorkspaceStore((state) => state.resetConversationFeed);
  const setLoading = useWorkspaceStore((state) => state.setLoading);
  const hydrateMessages = useWorkspaceStore((state) => state.hydrateMessages);
  const addPendingMessage = useWorkspaceStore((state) => state.addPendingMessage);
  const receiveMessage = useWorkspaceStore((state) => state.receiveMessage);
  const removeMessage = useWorkspaceStore((state) => state.removeMessage);
  const upsertApproval = useWorkspaceStore((state) => state.upsertApproval);
  const upsertRun = useWorkspaceStore((state) => state.upsertRun);
  const appendActivity = useWorkspaceStore((state) => state.appendActivity);
  const appendMember = useWorkspaceStore((state) => state.appendMember);
  const setMemberActivity = useWorkspaceStore((state) => state.setMemberActivity);
  const [error, setError] = useState<{ conversationKey: string; message: string } | undefined>(undefined);
  const storeMembersRef = useRef(storeMembers);

  useEffect(() => {
    storeMembersRef.current = storeMembers;
  }, [storeMembers]);

  useEffect(() => {
    if (!transport) {
      return;
    }

    const abortController = new AbortController();
    const currentConversationKey = `${transport.organizationId}:${transport.threadId}`;
    resetConversationFeed(currentConversationKey);

    void loadHistory(transport.organizationId, transport.threadId, abortController.signal)
      .then((history) => {
        if (abortController.signal.aborted || currentConversationKey !== conversationKey) return;
        setError(undefined);
        hydrateMessages(history, (message) => messageToChatMessage(message, storeMembersRef.current), messageToActivity);
        setLoading(false);
      })
      .catch((err) => {
        if (abortController.signal.aborted || currentConversationKey !== conversationKey) return;
        setLoading(false);
        setError({
          conversationKey: currentConversationKey,
          message: err instanceof Error ? err.message : "Unable to load conversation history.",
        });
      });

    const params = buildConversationStreamParams(transport);
    const source = new EventSource(`/api/conversations/stream?${params.toString()}`);
    source.onmessage = (event) => {
      const parsed = parseStreamEnvelope(event.data);
      if (!parsed) return;
      if (parsed.type === "ready") {
        setError(undefined);
        return;
      }
      if (parsed.type === "error") {
        setLoading(false);
        setError({ conversationKey: currentConversationKey, message: parsed.message });
        if (conversation.type === "agent") setMemberActivity(conversation.id, "error");
        return;
      }
      handleStreamEvent(parsed, {
        appendActivity,
        appendMember,
        receiveMessage,
        removeMessage,
        setConversationError: (message) =>
          setError(
            message
              ? { conversationKey: currentConversationKey, message }
              : undefined,
          ),
        setLoading,
        setMemberActivity,
        storeMembers: storeMembersRef.current,
        upsertApproval,
        upsertRun,
      });
    };
    source.onerror = () => {
      setLoading(false);
      setError({ conversationKey: currentConversationKey, message: "Conversation stream disconnected." });
      if (conversation.type === "agent") setMemberActivity(conversation.id, "error");
    };

    return () => {
      abortController.abort();
      source.close();
    };
  }, [
    appendActivity,
    appendMember,
    hydrateMessages,
    receiveMessage,
    removeMessage,
    resetConversationFeed,
    setLoading,
    setMemberActivity,
    transport,
    conversationKey,
    conversation.id,
    conversation.type,
    upsertApproval,
    upsertRun,
  ]);

  const selectedMember = useMemo(() => {
    if (conversation.type !== "agent") return undefined;
    return storeMembers.find((member) => member.id === conversation.id);
  }, [conversation.id, conversation.type, storeMembers]);

  const activeRun = useMemo(
    () => [...runs].reverse().find((run) => ["queued", "running", "waiting_for_approval"].includes(run.status)),
    [runs],
  );

  const status = useMemo(() => {
    if (conversation.type !== "agent") {
      return { variant: "active" as const, label: "online" };
    }
    const activityState =
      memberActivity[conversation.id] ??
      conversationActivityState({
        loading,
        activeRun: activeRun ? { status: activeRun.status } : undefined,
        presence: selectedMember?.presence,
      });
    return activityStateToStatus(activityState);
  }, [activeRun, conversation.id, conversation.type, loading, memberActivity, selectedMember?.presence]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!transport || !bootstrap.auth.member) {
        throw new Error("Sign in before sending messages.");
      }

      const sender = bootstrap.auth.member;
      const tempId = `temp:${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      addPendingMessage({
        id: tempId,
        senderId: sender.id,
        role: sender.roleName,
        name: sender.name,
        time: "now",
        content,
        createdAt: now,
        pending: true,
        tag: { label: "Sending", variant: "default" },
        detail: "Sending…",
      });

      const response = await fetch("/api/messages", {
        method: "POST",
        body: JSON.stringify(
          buildConversationMessagePayload(
            transport,
            conversation.type,
            conversation.id,
            sender.id,
            content,
          ),
        ),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        removeMessage(tempId);
        throw new Error(
          body &&
            typeof body === "object" &&
            "message" in body &&
            typeof body.message === "string"
            ? body.message
            : "Unable to send message.",
        );
      }

      const parsed = MessageSchema.safeParse(body);
      if (!parsed.success) {
        removeMessage(tempId);
        throw new Error("Unexpected message response.");
      }
    },
    [addPendingMessage, bootstrap.auth.member, conversation.id, conversation.type, removeMessage, transport],
  );

  useEffect(() => {
    if (conversation.type !== "agent") return;
    if (loading) {
      setMemberActivity(conversation.id, "loading");
      return;
    }
    if (activeRun) {
      setMemberActivity(conversation.id, "working");
      return;
    }
    if (selectedMember?.presence) {
      setMemberActivity(conversation.id, presenceToActivityState(selectedMember.presence));
    }
  }, [activeRun, conversation.id, conversation.type, loading, selectedMember?.presence, setMemberActivity]);

  const currentError =
    error && error.conversationKey === conversationKey ? error.message : undefined;
  const messagesWithReplyPreview = useMemo(
    () => attachReplyPreviews(messages),
    [messages],
  );

  return {
    messages: messagesWithReplyPreview,
    approvals,
    runs,
    activity,
    selectedMember,
    status,
    loading,
    error: currentError,
    sendMessage,
  };
}

function attachReplyPreviews(messages: ChatMessageData[]): ChatMessageData[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return messages.map((message) => {
    if (!message.parentMessageId) return message;
    const parent = byId.get(message.parentMessageId);
    if (!parent) return message;
    return {
      ...message,
      replyPreview: {
        name: parent.name,
        content: parent.content,
      },
    };
  });
}

async function loadHistory(
  organizationId: string,
  threadId: string,
  signal: AbortSignal,
): Promise<Message[]> {
  const messages: Message[] = [];
  let cursor: string | undefined;

  for (;;) {
    const params = new URLSearchParams({
      organizationId,
      threadId,
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(`/api/conversations/history?${params.toString()}`, {
      signal,
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error("Unable to load conversation history.");
    }

    if (body && Array.isArray(body.data)) {
      messages.push(
        ...body.data.flatMap((item: unknown) => {
          const parsed = MessageSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        }),
      );
    }

    if (!body?.hasMore || typeof body.nextCursor !== "string" || body.nextCursor === cursor) {
      return messages;
    }

    cursor = body.nextCursor;
  }
}

function parseStreamEnvelope(value: string): ConversationStreamEnvelope | null {
  try {
    const parsed = JSON.parse(value) as ConversationStreamEnvelope;
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function handleStreamEvent(
  envelope: Exclude<ConversationStreamEnvelope, { type: "ready" } | { type: "error" }>,
  actions: {
    appendActivity(event: ActivityEvent): void;
    appendMember(member: Member): void;
    receiveMessage(
      tempId: string | undefined,
      message: Message,
      toMessage: (message: Message) => ChatMessageData,
      toActivity: (message: Message) => ActivityEvent,
    ): void;
    removeMessage(id: string): void;
    setConversationError(message: string | undefined): void;
    setLoading(loading: boolean): void;
    setMemberActivity(memberId: string, activity: ActivityState): void;
    storeMembers: Member[];
    upsertApproval(
      approval: ApprovalRequest,
      toCard: (approval: ApprovalRequest, state: { members: Member[] }) => ApprovalCardData,
      toActivity: (approval: ApprovalRequest) => ActivityEvent,
    ): void;
    upsertRun(run: RunState, toActivity: (run: RunState) => ActivityEvent): void;
  },
): void {
  if (envelope.type !== "socket") return;

  switch (envelope.event) {
    case "channel:message":
    case "thread:message":
    case "dm:message": {
      const message = parseMessagePayload(envelope.payload);
      if (!message) return;
      actions.receiveMessage(undefined, message, (value) => messageToChatMessage(value, actions.storeMembers), messageToActivity);
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
      }
      if (run.status === "failed" || run.status === "cancelled") {
        actions.setMemberActivity(run.agentId, "error");
      } else if (run.status === "completed") {
        const member = actions.storeMembers.find((m) => m.id === run.agentId);
        actions.setMemberActivity(run.agentId, presenceToActivityState(member?.presence));
      } else {
        actions.setMemberActivity(run.agentId, "working");
      }
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
    case "tool:result":
      actions.appendActivity(toolToActivity(envelope.event, envelope.payload));
      return;
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

interface MemberAlertFailedPayload {
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

function messageToChatMessage(message: Message, members: Member[]): ChatMessageData {
  const sender = members.find((member) => member.id === message.senderId);
  return {
    id: message.id,
    senderId: message.senderId,
    parentMessageId: message.parentMessageId,
    role: sender?.roleName ?? message.senderKind,
    name: sender?.name ?? message.senderId,
    time: formatTime(message.createdAt),
    content: message.content,
    createdAt: message.createdAt,
    mentionNames:
      message.mentionNames?.length
        ? message.mentionNames
        : resolveMentionNames(message.content, members),
    pending: false,
  };
}

function resolveMentionNames(content: string, members: Member[]): string[] {
  const byName = [...members.map((member) => member.name), "all"]
    .filter((name) => name.trim().length > 0)
    .sort((left, right) => right.length - left.length);
  const names = new Set<string>();
  const lower = content.toLowerCase();
  let index = 0;

  while (index < content.length) {
    const mentionIndex = content.indexOf("@", index);
    if (mentionIndex === -1) break;
    const remaining = lower.slice(mentionIndex + 1);
    let matched = false;

    for (const name of byName) {
      if (!remaining.startsWith(name.toLowerCase())) continue;
      const nextChar = remaining[name.length];
      if (nextChar && /\w/.test(nextChar)) continue;
      names.add(name);
      index = mentionIndex + 1 + name.length;
      matched = true;
      break;
    }

    if (matched) continue;
    index = mentionIndex + 1;
  }

  return [...names];
}

function messageToActivity(message: Message): ActivityEvent {
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
    },
  };
}

function parseScopeFromReason(reason: string): string | null {
  const match = reason.match(/(?:^|;)scope=([^;]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Matches `ToolServiceImpl.buildApprovalScope` for shell:
 * `shell:${cwd}:${command}:${JSON.stringify(args)}`
 */
function parseShellScope(scope: string): { cwd: string; command: string; args: string[] } | null {
  if (!scope.startsWith("shell:")) return null;
  const withoutPrefix = scope.slice("shell:".length);
  const jsonStart = withoutPrefix.indexOf("[");
  if (jsonStart <= 0) return null;
  const jsonPart = withoutPrefix.slice(jsonStart);
  let args: string[] = [];
  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    args = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    args = [];
  }
  const beforeJson = withoutPrefix.slice(0, jsonStart - 1);
  const lastColon = beforeJson.lastIndexOf(":");
  if (lastColon === -1) return null;
  const cwd = beforeJson.slice(0, lastColon);
  const command = beforeJson.slice(lastColon + 1);
  return { cwd, command, args };
}

function formatShellCommandPreview(parsed: { cwd: string; command: string; args: string[] }): string {
  const words = [parsed.command, ...parsed.args].filter(Boolean);
  const line = `$ ${words.join(" ")}`;
  return `${line}\nDirectory: ${parsed.cwd}`;
}

function approvalToCard(
  approval: ApprovalRequest,
  state: { members: Member[] },
): ApprovalCardData {
  const requestedBy =
    state.members.find((member) => member.id === approval.requestedBy)?.name ?? approval.requestedBy;

  const scopeDecoded = parseScopeFromReason(approval.reason);
  let title =
    approval.status === "pending" ? "Approval requested" : `Approval ${approval.status}`;
  let description = `${approval.action} ${approval.resourcePath}`;
  let commandPreview: string | undefined;

  if (approval.resourceType === "shell" && scopeDecoded) {
    const parsed = parseShellScope(scopeDecoded);
    if (parsed) {
      title = approval.status === "pending" ? "Shell command" : title;
      description = "The agent wants to run:";
      commandPreview = formatShellCommandPreview(parsed);
    }
  }

  return {
    id: approval.id,
    runId: approval.runId,
    title,
    description,
    commandPreview,
    status: approval.status,
    requestedBy,
    approvalsNeeded: 1,
  };
}

function approvalToActivity(approval: ApprovalRequest): ActivityEvent {
  return {
    event_id: `approval:${approval.id}:${approval.status}:${approval.resolvedAt ?? approval.createdAt}`,
    type: approval.status === "pending" ? "approval_requested" : `approval_${approval.status}`,
    publisher: approval.requestedBy,
    timestamp: approval.resolvedAt ?? approval.createdAt,
    task_id: approval.runId,
    payload: approval,
  };
}

function runToActivity(run: RunState): ActivityEvent {
  return {
    event_id: `run:${run.id}:${run.status}:${run.step}:${run.endedAt ?? run.startedAt}`,
    type: `run_${run.status}`,
    publisher: run.agentId,
    timestamp: run.endedAt ?? run.startedAt,
    task_id: run.id,
    payload: run,
  };
}

function toolToActivity(
  event: "tool:called" | "tool:result",
  payload: unknown,
): ActivityEvent {
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

function presenceToActivity(payload: unknown): ActivityEvent {
  const body = payload as { memberId?: string; state?: string };
  return {
    event_id: `presence:${String(body.memberId ?? "unknown")}:${String(body.state ?? "unknown")}:${Date.now()}`,
    type: "channel_presence",
    publisher: String(body.memberId ?? "unknown"),
    timestamp: new Date().toISOString(),
    payload,
  };
}

function memberToActivity(member: Member): ActivityEvent {
  return {
    event_id: `member:${member.id}:${member.presence ?? "unknown"}:${member.createdAt ?? Date.now()}`,
    type: "member_updated",
    publisher: member.id,
    timestamp: member.createdAt ?? new Date().toISOString(),
    payload: member,
  };
}

function memberAlertFailedToActivity(payload: MemberAlertFailedPayload): ActivityEvent {
  return {
    event_id: `member-alert-failed:${payload.memberId}:${payload.messageId}:${payload.stage}:${payload.occurredAt}`,
    type: "member_alert_failed",
    publisher: payload.memberId,
    timestamp: payload.occurredAt,
    task_id: payload.runId,
    payload,
  };
}

function formatTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "now";
  return new Date(parsed).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
