"use client";

import { useCallback, useEffect, useMemo, useReducer, type Dispatch } from "react";
import {
  appendEvents,
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
  type ConversationStreamEnvelope,
  resolveConversationTransport,
} from "./conversation-transport";

const MAX_ACTIVITY = 200;

interface ConversationFeedState {
  messages: ChatMessageData[];
  approvals: ApprovalCardData[];
  runs: RunState[];
  activity: ActivityEvent[];
  members: Member[];
  loading: boolean;
}

type ConversationFeedAction =
  | { type: "reset" }
  | { type: "loading"; loading: boolean }
  | { type: "sync-members"; members: Member[] }
  | { type: "hydrate-messages"; messages: Message[] }
  | { type: "pending-message"; message: ChatMessageData }
  | { type: "receive-message"; tempId?: string; message: Message }
  | { type: "remove-message"; id: string }
  | { type: "upsert-approval"; approval: ApprovalRequest }
  | { type: "upsert-run"; run: RunState }
  | { type: "append-activity"; event: ActivityEvent };

const EMPTY_STATE: ConversationFeedState = {
  messages: [],
  approvals: [],
  runs: [],
  activity: [],
  members: [],
  loading: true,
};

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
  sendMessage(content: string): Promise<void>;
}

export function useConversationSync(
  bootstrap: BootstrapResponse,
  conversation: SelectedConversation,
  members: Member[],
): ConversationSyncResult {
  const transport = useMemo(
    () => resolveConversationTransport(bootstrap, conversation),
    [bootstrap, conversation],
  );
  const [state, dispatch] = useReducer(reducer, EMPTY_STATE);

  useEffect(() => {
    dispatch({ type: "sync-members", members });
  }, [members]);

  useEffect(() => {
    if (!transport) {
      dispatch({ type: "reset" });
      return;
    }

    const abortController = new AbortController();
    dispatch({ type: "reset" });

    void loadHistory(transport.organizationId, transport.threadId, abortController.signal)
      .then((messages) => {
        if (abortController.signal.aborted) return;
        dispatch({ type: "hydrate-messages", messages });
        dispatch({ type: "loading", loading: false });
      })
      .catch(() => {
        if (abortController.signal.aborted) return;
        dispatch({ type: "loading", loading: false });
      });

    const params = new URLSearchParams({
      organizationId: transport.organizationId,
      threadId: transport.threadId,
    });
    for (const memberId of transport.memberIds) {
      params.append("memberIds", memberId);
    }
    for (const threadId of transport.threadIds) {
      params.append("threadIds", threadId);
    }

    const source = new EventSource(`/api/conversations/stream?${params.toString()}`);
    source.onmessage = (event) => {
      const parsed = parseStreamEnvelope(event.data);
      if (!parsed) return;
      if (parsed.type === "ready") return;
      if (parsed.type === "error") {
        dispatch({ type: "loading", loading: false });
        return;
      }
      handleStreamEvent(parsed, dispatch);
    };
    source.onerror = () => {
      dispatch({ type: "loading", loading: false });
    };

    return () => {
      abortController.abort();
      source.close();
    };
  }, [transport]);

  const selectedMember = useMemo(() => {
    if (conversation.type !== "agent" && conversation.type !== "dm") {
      return undefined;
    }
    return state.members.find((member) => member.id === conversation.id);
  }, [conversation.id, conversation.type, state.members]);

  const status = useMemo(
    () => memberPresenceToStatus(selectedMember?.presence),
    [selectedMember?.presence],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!transport || !bootstrap.auth.member) {
        throw new Error("Sign in before sending messages.");
      }

      const sender = bootstrap.auth.member;
      const tempId = `temp:${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      dispatch({
        type: "pending-message",
        message: {
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
        },
      });

      const response = await fetch("/api/messages", {
        method: "POST",
        body: JSON.stringify(
          transport.recipientId
            ? {
                organizationId: transport.organizationId,
                senderId: sender.id,
                recipientId: transport.recipientId,
                content,
              }
            : {
                organizationId: transport.organizationId,
                senderId: sender.id,
                threadId: transport.threadId,
                channelId: conversation.type === "channel" ? conversation.id : undefined,
                content,
              },
        ),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        dispatch({ type: "remove-message", id: tempId });
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
        dispatch({ type: "remove-message", id: tempId });
        throw new Error("Unexpected message response.");
      }

      dispatch({ type: "receive-message", tempId, message: parsed.data });
    },
    [bootstrap.auth.member, conversation.id, conversation.type, transport],
  );

  return {
    messages: state.messages,
    approvals: state.approvals,
    runs: state.runs,
    activity: state.activity,
    selectedMember,
    status,
    loading: state.loading,
    sendMessage,
  };
}

function reducer(
  state: ConversationFeedState,
  action: ConversationFeedAction,
): ConversationFeedState {
  switch (action.type) {
    case "reset":
      return { ...EMPTY_STATE, members: state.members };
    case "loading":
      return { ...state, loading: action.loading };
    case "sync-members":
      return { ...state, members: mergeMembers(state.members, action.members) };
    case "hydrate-messages": {
      const hydrated = action.messages.map((message) => messageToChatMessage(message, state));
      return {
        ...state,
        messages: mergeChatMessages(state.messages, hydrated),
        activity: appendActivity(state.activity, action.messages.map(messageToActivity)),
      };
    }
    case "pending-message":
      return {
        ...state,
        messages: mergeChatMessages(state.messages, [action.message]),
      };
    case "receive-message": {
      const message = messageToChatMessage(action.message, state);
      const withoutTemp = action.tempId
        ? state.messages.filter((item) => item.id !== action.tempId)
        : state.messages.filter(
            (item) =>
              !(item.pending && item.name === message.name && item.content === message.content),
          );
      return {
        ...state,
        messages: mergeChatMessages(withoutTemp, [message]),
        activity: appendActivity(state.activity, [messageToActivity(action.message)]),
      };
    }
    case "remove-message":
      return {
        ...state,
        messages: state.messages.filter((message) => message.id !== action.id),
      };
    case "upsert-approval": {
      const approval = approvalToCard(action.approval, state);
      return {
        ...state,
        approvals: mergeApprovals(state.approvals, [approval]),
        activity: appendActivity(state.activity, [approvalToActivity(action.approval)]),
      };
    }
    case "upsert-run":
      return {
        ...state,
        runs: mergeRuns(state.runs, [action.run]),
        activity: appendActivity(state.activity, [runToActivity(action.run)]),
      };
    case "append-activity":
      return { ...state, activity: appendActivity(state.activity, [action.event]) };
    default:
      return state;
  }
}

async function loadHistory(
  organizationId: string,
  threadId: string,
  signal: AbortSignal,
): Promise<Message[]> {
  const response = await fetch(
    `/api/conversations/history?organizationId=${encodeURIComponent(organizationId)}&threadId=${encodeURIComponent(threadId)}&limit=100`,
    { signal },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error("Unable to load conversation history.");
  }
  if (!body || !Array.isArray(body.data)) return [];
  return body.data.flatMap((item: unknown) => {
    const parsed = MessageSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
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
  dispatch: Dispatch<ConversationFeedAction>,
): void {
  if (envelope.type !== "socket") return;

  switch (envelope.event) {
    case "channel:message":
    case "thread:message":
    case "dm:message": {
      const message = parseMessagePayload(envelope.payload);
      if (!message) return;
      dispatch({ type: "receive-message", message });
      return;
    }
    case "approval:requested":
    case "approval:resolved": {
      const approval = parseApprovalPayload(envelope.payload);
      if (!approval) return;
      dispatch({ type: "upsert-approval", approval });
      return;
    }
    case "run:started":
    case "run:updated":
    case "run:completed": {
      const run = parseRunPayload(envelope.payload);
      if (!run) return;
      dispatch({ type: "upsert-run", run });
      return;
    }
    case "member:updated": {
      const member = parseMemberPayload(envelope.payload);
      if (!member) return;
      dispatch({ type: "sync-members", members: [member] });
      dispatch({ type: "append-activity", event: memberToActivity(member) });
      return;
    }
    case "channel:presence":
      dispatch({ type: "append-activity", event: presenceToActivity(envelope.payload) });
      return;
    case "tool:called":
    case "tool:result":
      dispatch({ type: "append-activity", event: toolToActivity(envelope.event, envelope.payload) });
      return;
    default:
      return;
  }
}

function mergeChatMessages(
  current: ChatMessageData[],
  incoming: ChatMessageData[],
): ChatMessageData[] {
  const map = new Map<string, ChatMessageData>();
  for (const message of [...current, ...incoming]) {
    map.set(message.id, message);
  }
  return [...map.values()].sort(
    (a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""),
  );
}

function mergeApprovals(
  current: ApprovalCardData[],
  incoming: ApprovalCardData[],
): ApprovalCardData[] {
  const map = new Map<string, ApprovalCardData>();
  for (const item of current) map.set(item.id, item);
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function mergeRuns(current: RunState[], incoming: RunState[]): RunState[] {
  const map = new Map<string, RunState>();
  for (const run of current) map.set(run.id, run);
  for (const run of incoming) map.set(run.id, run);
  return [...map.values()].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
}

function mergeMembers(current: Member[], incoming: Member[]): Member[] {
  const map = new Map<string, Member>();
  for (const member of current) map.set(member.id, member);
  for (const member of incoming) map.set(member.id, member);
  return [...map.values()];
}

function appendActivity(current: ActivityEvent[], incoming: ActivityEvent[]): ActivityEvent[] {
  return appendEvents(current, incoming, { max: MAX_ACTIVITY });
}

function messageToChatMessage(message: Message, state: Pick<ConversationFeedState, "members">): ChatMessageData {
  const sender = state.members.find((member) => member.id === message.senderId);
  return {
    id: message.id,
    senderId: message.senderId,
    role: sender?.roleName ?? message.senderKind,
    name: sender?.name ?? message.senderId,
    time: formatTime(message.createdAt),
    content: message.content,
    createdAt: message.createdAt,
    pending: false,
  };
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

function approvalToCard(
  approval: ApprovalRequest,
  state: Pick<ConversationFeedState, "members">,
): ApprovalCardData {
  const requestedBy =
    state.members.find((member) => member.id === approval.requestedBy)?.name ?? approval.requestedBy;
  return {
    id: approval.id,
    title: approval.status === "pending" ? "Approval requested" : `Approval ${approval.status}`,
    description: `${approval.action} ${approval.resourcePath}`,
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

function formatTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "now";
  return new Date(parsed).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function memberPresenceToStatus(presence?: string): {
  variant: "active" | "idle" | "offline" | "error";
  label: string;
} {
  switch (presence) {
    case "online":
      return { variant: "active", label: "online" };
    case "busy":
      return { variant: "idle", label: "busy" };
    case "away":
      return { variant: "idle", label: "away" };
    case "offline":
      return { variant: "offline", label: "offline" };
    default:
      return { variant: "active", label: "active" };
  }
}
