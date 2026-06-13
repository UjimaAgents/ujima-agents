"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApprovalRequestSchema,
  MemberSchema,
  MessageSchema,
  RunChunkEventSchema,
  RunStateSchema,
  RunTokenUsageEventSchema,
  type ActivityEvent,
  type ApprovalRequest,
  type Member,
  type Message,
  type RunChunkEvent,
  type RunState,
  type RunTokenUsageEvent,
  buildMentionHandleRegistry,
  scanMentionsInContent,
} from "@ujima/shared/browser";
import { BootstrapResponseSchema, type BootstrapResponse } from "@ujima/api-schema";
import type { ApprovalCardData, ChatMessageData } from "./components/chat";
import type { SelectedConversation } from "./types";
import {
  buildConversationMessagePayload,
  buildConversationStreamParams,
  resolveConversationTransport,
  type ConversationStreamEnvelope,
} from "./conversation-transport";
import type { ReasoningEffort } from "@ujima/shared/browser";
import {
  activityStateToStatus,
  conversationActivityState,
  presenceToActivityState,
  runStatusToActivityState,
  type ActivityState,
} from "./activity-state";
import { pendingApprovalVisibleInChannelView } from "./approval-thread-filter";
import { approvalToCard } from "./approval-card-data";
import {
  approvalToActivity,
  memberAlertedToActivity,
  memberAlertFailedToActivity,
  memberToActivity,
  messageToActivity,
  presenceToActivity,
  runChunkToActivity,
  runToActivity,
  socketEventToActivity,
  toolToActivity,
  type MemberAlertFailedPayload,
  type MemberAlertedPayload,
} from "./activity-events";
import { formatTimestamp } from "./lib/format-timestamp";
import { StreamChunkBatcher, type RunChunkStoreItem } from "./stream-chunk-batcher";
import { useWorkspaceStore } from "./workspace-store";

function isActiveRun(run: RunState): boolean {
  return (
    run.status === "queued" ||
    run.status === "running" ||
    run.status === "waiting_for_approval" ||
    run.status === "waiting_for_input"
  );
}

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
  sendMessage(
    content: string,
    parentMessageId?: string,
    attachmentIds?: string[],
    metadata?: { goalMode?: boolean; reasoningEffort?: ReasoningEffort },
    /**
     * Retry/resend hook: when present, sendMessage reuses this
     * idempotency key (and the matching `temp:<id>` pending entry)
     * instead of allocating a fresh one. Bind it to the user-visible
     * draft, not to the call site, so a "Retry" button hits the same
     * dedupe key the original send did. Migration 021's UNIQUE partial
     * index on `messages(org, sender, thread, clientMessageId)`
     * enforces the contract at the DB layer.
     */
    options?: { clientMessageId?: string },
  ): Promise<void>;
  archiveConversation(mode: "summarize" | "clear"): Promise<void>;
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
  const appendRunChunkBatchToStore = useWorkspaceStore((state) => state.appendRunChunkBatch);
  const removeMessage = useWorkspaceStore((state) => state.removeMessage);
  const replaceApprovals = useWorkspaceStore((state) => state.replaceApprovals);
  const replaceRuns = useWorkspaceStore((state) => state.replaceRuns);
  const upsertApproval = useWorkspaceStore((state) => state.upsertApproval);
  const upsertRun = useWorkspaceStore((state) => state.upsertRun);
  const setRunTokens = useWorkspaceStore((state) => state.setRunTokens);
  const appendActivity = useWorkspaceStore((state) => state.appendActivity);
  const appendMember = useWorkspaceStore((state) => state.appendMember);
  const setMemberActivity = useWorkspaceStore((state) => state.setMemberActivity);
  const [error, setError] = useState<{ conversationKey: string; message: string } | undefined>(undefined);
  const storeMembersRef = useRef(storeMembers);
  const runsRef = useRef(runs);
  const runChunkSequenceRef = useRef(0);
  const runChunkBatcherRef = useRef<StreamChunkBatcher | null>(null);

  useEffect(() => {
    storeMembersRef.current = storeMembers;
  }, [storeMembers]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    runChunkSequenceRef.current = 0;
    runChunkBatcherRef.current?.dispose();
    runChunkBatcherRef.current = new StreamChunkBatcher((items) => {
      appendRunChunkBatchToStore(items);
    });
    return () => {
      runChunkBatcherRef.current?.dispose();
      runChunkBatcherRef.current = null;
    };
  }, [appendRunChunkBatchToStore, conversationKey]);

  const queueRunChunk = useCallback((chunk: RunChunkEvent) => {
    const item = buildRunChunkItem({
      chunk,
      members: storeMembersRef.current,
      sequence: runChunkSequenceRef.current++,
    });
    runChunkBatcherRef.current?.push(item);
  }, []);
  const flushRunChunks = useCallback(() => {
    runChunkBatcherRef.current?.flushNow();
  }, []);

  const loadConversationState = useCallback(
    async (signal: AbortSignal, currentConversationKey: string) => {
      if (!transport) return;
      const [history, latestBootstrap] = await Promise.all([
        loadHistory(transport.organizationId, transport.threadId, signal),
        loadBootstrap(signal),
      ]);
      if (signal.aborted || currentConversationKey !== conversationKey) return;
      setError(undefined);
      hydrateMessages(history, (message) => messageToChatMessage(message, storeMembersRef.current), messageToActivity);
      const activeRuns = latestBootstrap?.activeRuns ?? bootstrap.activeRuns;
      const pendingApprovals = latestBootstrap?.pendingApprovals ?? bootstrap.pendingApprovals;
      const latestMembers = latestBootstrap?.members ?? bootstrap.members;
      const threadRuns = activeRuns.filter((run) => run.threadId === transport.threadId);
      const visibleApprovals = pendingApprovals.filter((approval) =>
        shouldHydrateApproval(approval, {
          conversation,
          currentThreadId: transport.threadId,
          runs: activeRuns,
        }),
      );
      replaceRuns(threadRuns);
      replaceApprovals(
        visibleApprovals.map((approval) => approvalToCard(approval, { members: latestMembers })),
      );
      const activeRunIds = new Set(activeRuns.map((run) => run.id));
      for (const staleRun of runsRef.current.filter(
        (run) => run.threadId === transport.threadId && !activeRunIds.has(run.id),
      )) {
        const member = latestMembers.find((item) => item.id === staleRun.agentId);
        setMemberActivity(staleRun.agentId, presenceToActivityState(member?.presence));
      }
      for (const run of threadRuns) {
        upsertRun(run, runToActivity);
      }
      for (const approval of visibleApprovals) {
        upsertApproval(
          approval,
          (value, state) => approvalToCard(value, { members: state.members }),
          approvalToActivity,
        );
      }
      setLoading(false);
    },
    [
      bootstrap.activeRuns,
      bootstrap.members,
      bootstrap.pendingApprovals,
      conversation,
      conversationKey,
      hydrateMessages,
      replaceApprovals,
      replaceRuns,
      setLoading,
      setMemberActivity,
      transport,
      upsertApproval,
      upsertRun,
    ],
  );

  useEffect(() => {
    if (!transport) {
      return;
    }

    const abortController = new AbortController();
    const currentConversationKey = `${transport.organizationId}:${transport.threadId}`;
    const loadTimer = window.setTimeout(() => {
      resetConversationFeed(currentConversationKey);
      void loadConversationState(abortController.signal, currentConversationKey).catch((err) => {
        if (abortController.signal.aborted || currentConversationKey !== conversationKey) return;
        setLoading(false);
        setError({
          conversationKey: currentConversationKey,
          message: err instanceof Error ? err.message : "Unable to load conversation history.",
        });
      });
    }, 0);

    const params = buildConversationStreamParams(transport);
    const source = new EventSource(`/api/conversations/stream?${params.toString()}`);
    let seenReady = false;
    source.onmessage = (event) => {
      const parsed = parseStreamEnvelope(event.data);
      if (!parsed) return;
      if (parsed.type === "ready") {
        setError(undefined);
        if (seenReady) {
          void loadConversationState(abortController.signal, currentConversationKey).catch((err) => {
            if (abortController.signal.aborted || currentConversationKey !== conversationKey) return;
            setLoading(false);
            setError({
              conversationKey: currentConversationKey,
              message: err instanceof Error ? err.message : "Unable to load conversation history.",
            });
          });
        } else {
          seenReady = true;
        }
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
        appendRunChunk: queueRunChunk,
        flushRunChunks,
        upsertApproval,
        upsertRun,
        setRunTokens,
      });
    };
    source.onopen = () => {
      setError(undefined);
    };
    source.onerror = () => {
      setLoading(false);
      if (source.readyState === EventSource.CLOSED) {
        setError({ conversationKey: currentConversationKey, message: "Conversation stream disconnected." });
        if (conversation.type === "agent") setMemberActivity(conversation.id, "error");
      }
    };

    return () => {
      abortController.abort();
      window.clearTimeout(loadTimer);
      source.close();
    };
  }, [
    appendActivity,
    appendMember,
    conversation,
    conversation.id,
    conversation.type,
    conversationKey,
    loadConversationState,
    flushRunChunks,
    queueRunChunk,
    receiveMessage,
    removeMessage,
    resetConversationFeed,
    setLoading,
    setMemberActivity,
    setRunTokens,
    transport,
    upsertApproval,
    upsertRun,
  ]);

  const selectedMember = useMemo(() => {
    if (conversation.type !== "agent") return undefined;
    return storeMembers.find((member) => member.id === conversation.id);
  }, [conversation.id, conversation.type, storeMembers]);

  const activeRun = useMemo(() => {
    if (!transport) return undefined;
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const run = runs[index];
      if (run.threadId === transport.threadId && isActiveRun(run)) return run;
    }
    return undefined;
  }, [runs, transport]);

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

  const sendMessage = useCallback<ConversationSyncResult["sendMessage"]>(
    async (content, parentMessageId, attachmentIds, metadata, options) => {
      if (!transport || !bootstrap.auth.member) {
        throw new Error("Sign in before sending messages.");
      }

      const sender = bootstrap.auth.member;
      const now = new Date().toISOString();
      // L10 — bind the idempotency token to the pending-message
      // identity by deriving the tempId FROM the clientMessageId,
      // not generating them independently. A retry path (transport
      // hiccup or future user-visible "Retry" affordance) MUST pass
      // the original clientMessageId via `options.clientMessageId` so
      // the daemon dedupes correctly. Without the threaded id, a
      // resend allocates a fresh key and the dedupe contract breaks.
      // Migration 021's UNIQUE partial index on
      // (org, sender, thread, clientMessageId) backs this at the DB
      // layer for concurrent retries.
      const clientMessageId = options?.clientMessageId ?? crypto.randomUUID();
      const tempId = `temp:${clientMessageId}`;
      // Retries reuse the same tempId. The earlier failed attempt
      // calls `removeMessage(tempId)` in its error branch, so the
      // pending entry is gone by the time a retry lands and we add
      // it back fresh. If a caller resends without removing first
      // (e.g. a "stuck pending" affordance), Pinia/Zustand stores
      // typically upsert by id — add-then-overwrite is benign.
      addPendingMessage({
        id: tempId,
        senderId: sender.id,
        role: sender.roleName,
        name: sender.name,
        time: "now",
        content,
        createdAt: now,
        parentMessageId,
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
            parentMessageId,
            attachmentIds,
            metadata,
            clientMessageId,
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

      receiveMessage(tempId, parsed.data, (value) => messageToChatMessage(value, storeMembersRef.current), messageToActivity);
    },
    [addPendingMessage, bootstrap.auth.member, conversation.id, conversation.type, receiveMessage, removeMessage, transport],
  );

  const archiveConversation = useCallback(
    async (mode: "summarize" | "clear") => {
      if (!transport || !bootstrap.auth.member) {
        throw new Error("Sign in before archiving a conversation.");
      }

      const response = await fetch(`/api/conversations/${encodeURIComponent(transport.threadId)}/archive`, {
        method: "POST",
        body: JSON.stringify({
          organizationId: transport.organizationId,
          mode,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body &&
            typeof body === "object" &&
            "message" in body &&
            typeof body.message === "string"
            ? body.message
            : "Unable to archive conversation.",
        );
      }

      const controller = new AbortController();
      const currentConversationKey = `${transport.organizationId}:${transport.threadId}`;
      resetConversationFeed(currentConversationKey);
      await loadConversationState(controller.signal, currentConversationKey);
    },
    [bootstrap.auth.member, loadConversationState, resetConversationFeed, transport],
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

  return {
    messages,
    approvals,
    runs,
    activity,
    selectedMember,
    status,
    loading,
    error: currentError,
    sendMessage,
    archiveConversation,
  };
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

    if (response.status === 404) {
      return messages;
    }

    if (!response.ok) {
      const message =
        body && typeof body === "object" && "message" in body && typeof body.message === "string"
          ? body.message
          : "Unable to load conversation history.";
      throw new Error(message);
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

async function loadBootstrap(signal: AbortSignal): Promise<BootstrapResponse | null> {
  const response = await fetch("/api/bootstrap", { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) return null;
  const parsed = BootstrapResponseSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
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

function shouldHydrateApproval(
  approval: ApprovalRequest,
  input: {
    conversation: SelectedConversation;
    currentThreadId: string;
    runs: RunState[];
  },
): boolean {
  if (approval.status !== "pending") return false;
  return pendingApprovalVisibleInChannelView(
    {
      id: approval.id,
      status: approval.status,
      requestedByMemberId: approval.requestedBy,
      requestedBy: approval.requestedBy,
      threadId: approval.threadId,
      runId: approval.runId,
      createdAt: approval.createdAt,
    },
    { type: input.conversation.type, id: input.conversation.id },
    input.currentThreadId,
    input.runs,
  );
}

function handleStreamEvent(
  envelope: Exclude<ConversationStreamEnvelope, { type: "ready" } | { type: "error" }>,
  actions: {
    appendActivity(event: ActivityEvent): void;
    appendMember(member: Member): void;
    appendRunChunk(chunk: RunChunkEvent): void;
    flushRunChunks(): void;
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
    setRunTokens(runId: string, inputTokens: number, outputTokens: number): void;
  },
): void {
  if (envelope.type !== "socket") return;
  if (envelope.event !== "run:chunk") {
    actions.flushRunChunks();
  }

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
      actions.appendRunChunk(chunk);
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

function messageToChatMessage(message: Message, members: Member[]): ChatMessageData {
  const sender = members.find((member) => member.id === message.senderId);
  return {
    id: message.id,
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
    ...(message.metadata?.runId ? { streamRunId: message.metadata.runId } : {}),
  };
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

function buildRunChunkItem(input: {
  chunk: RunChunkEvent;
  members: Member[];
  sequence: number;
}): RunChunkStoreItem {
  if (input.chunk.kind === "reasoning" && input.chunk.delta) {
    return { activity: runChunkToActivity(input.chunk, input.sequence) };
  }
  if (input.chunk.kind !== "text" || !input.chunk.delta) {
    return {};
  }
  const member = input.members.find((item) => item.id === input.chunk.agentId);
  const createdAt = new Date().toISOString();
  return {
    message: {
      id: `stream:${input.chunk.runId}:${input.chunk.agentId}`,
      senderId: input.chunk.agentId,
      role: member?.roleName ?? "agent",
      name: member?.name ?? input.chunk.agentId,
      time: formatTime(createdAt),
      content: input.chunk.delta,
      kind: "agent",
      createdAt,
      threadId: input.chunk.threadId,
      streamRunId: input.chunk.runId,
      pending: true,
    },
  };
}

function formatTime(iso: string): string {
  return formatTimestamp(iso);
}
