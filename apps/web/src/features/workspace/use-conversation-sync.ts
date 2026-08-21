"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSchema,
  type ActivityEvent,
  type ApprovalRequest,
  type Member,
  type Message,
  type RunChunkEvent,
  type RunState,
} from "@ujima/shared/browser";
import { BootstrapResponseSchema, type BootstrapResponse } from "@ujima/api-schema";
import type { ApprovalCardData, ChatMessageData } from "./components/chat";
import type { SelectedConversation } from "./types";
import {
  buildConversationMessagePayload,
  buildConversationStreamParams,
  resolveConversationTransport,
  type ConversationMessageMetadata,
  type ConversationStreamEnvelope,
} from "./conversation-transport";
import {
  activityStateToStatus,
  conversationActivityState,
  presenceToActivityState,
} from "./activity-state";
import { pendingApprovalVisibleInChannelView } from "./approval-thread-filter";
import { approvalToCard } from "./approval-card-data";
import {
  approvalToActivity,
  messageToActivity,
  runChunkToActivity,
  runToActivity,
} from "./activity-events";
import { formatTimestamp } from "./lib/format-timestamp";
import {
  handleStreamEvent,
  messageModeTag,
  messageToChatMessage,
} from "./stream-event-handler";
import { StreamChunkBatcher, type RunChunkStoreItem } from "./stream-chunk-batcher";
import { useWorkspaceStore } from "./workspace-store";
import { ClientApiError, clientApiUrl, clientFetchJson } from "@/lib/client-api";

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
    metadata?: ConversationMessageMetadata,
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
  archiving: "summarize" | "clear" | null;
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
  const [archivingState, setArchivingState] = useState<{
    conversationKey: string;
    mode: "summarize" | "clear";
  } | null>(null);
  const storeMembersRef = useRef(storeMembers);
  const runsRef = useRef(runs);
  const runChunkSequenceRef = useRef(0);
  const runChunkBatcherRef = useRef<{ key: string; batcher: StreamChunkBatcher } | null>(null);

  useEffect(() => {
    storeMembersRef.current = storeMembers;
  }, [storeMembers]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    runChunkSequenceRef.current = 0;
    const key = conversationKey ?? "";
    const batcher = new StreamChunkBatcher((items) => {
      appendRunChunkBatchToStore(items, key);
    });
    runChunkBatcherRef.current = { key, batcher };
    return () => {
      if (runChunkBatcherRef.current?.batcher === batcher) {
        runChunkBatcherRef.current = null;
      }
      batcher.dispose();
    };
  }, [appendRunChunkBatchToStore, conversationKey]);

  const queueRunChunk = useCallback((chunk: RunChunkEvent, expectedConversationKey: string) => {
    const current = runChunkBatcherRef.current;
    if (!current || current.key !== expectedConversationKey) return;
    const item = buildRunChunkItem({
      chunk,
      members: storeMembersRef.current,
      sequence: runChunkSequenceRef.current++,
    });
    current.batcher.push(item);
  }, []);
  const flushRunChunks = useCallback((expectedConversationKey: string) => {
    const current = runChunkBatcherRef.current;
    if (current?.key === expectedConversationKey) current.batcher.flushNow();
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
      hydrateMessages(
        history,
        (message) => messageToChatMessage(message, storeMembersRef.current),
        messageToActivity,
        currentConversationKey,
      );
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
    const source = new EventSource(clientApiUrl(`/api/conversations/stream?${params.toString()}`));
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
        expectedConversationKey: currentConversationKey,
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
      const expectedConversationKey = conversationKey;
      // Retries reuse the same tempId. The earlier failed attempt
      // calls `removeMessage(tempId)` in its error branch, so the
      // pending entry is gone by the time a retry lands and we add
      // it back fresh. If a caller resends without removing first
      // (e.g. a "stuck pending" affordance), Pinia/Zustand stores
      // typically upsert by id — add-then-overwrite is benign.
      addPendingMessage({
        id: tempId,
        clientMessageId,
        senderId: sender.id,
        role: sender.roleName,
        name: sender.name,
        time: "now",
        content,
        createdAt: now,
        parentMessageId,
        pending: true,
        tag: messageModeTag(metadata) ?? { label: "Sending", variant: "default" },
        detail: "Sending…",
      });

      const requestBody = JSON.stringify(
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
      );
      let body: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          body = await clientFetchJson<unknown>(
            "/api/messages",
            { method: "POST", body: requestBody },
            "Unable to send message.",
          );
          break;
        } catch (error) {
          if (attempt === 1) {
            removeMessage(tempId);
            throw error;
          }
        }
      }
      if (body === undefined) {
        removeMessage(tempId);
        throw new Error("Unable to send message.");
      }

      const parsed = MessageSchema.safeParse(body);
      if (!parsed.success) {
        removeMessage(tempId);
        throw new Error("Unexpected message response.");
      }

      receiveMessage(tempId, parsed.data, (value) => messageToChatMessage(value, storeMembersRef.current), messageToActivity, expectedConversationKey);
    },
    [addPendingMessage, bootstrap.auth.member, conversation.id, conversation.type, conversationKey, receiveMessage, removeMessage, transport],
  );

  const archiveConversation = useCallback(
    async (mode: "summarize" | "clear") => {
      if (!transport || !bootstrap.auth.member || !conversationKey) {
        throw new Error("Sign in before archiving a conversation.");
      }

      setArchivingState({ conversationKey, mode });
      try {
        await clientFetchJson<unknown>(`/api/conversations/${encodeURIComponent(transport.threadId)}/archive`, {
          method: "POST",
          body: JSON.stringify({
            organizationId: transport.organizationId,
            mode,
          }),
        }, "Unable to archive conversation.");

        const controller = new AbortController();
        const currentConversationKey = `${transport.organizationId}:${transport.threadId}`;
        resetConversationFeed(currentConversationKey);
        await loadConversationState(controller.signal, currentConversationKey);
      } finally {
        setArchivingState(null);
      }
    },
    [bootstrap.auth.member, conversationKey, loadConversationState, resetConversationFeed, transport],
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
  const archiving =
    archivingState && archivingState.conversationKey === conversationKey
      ? archivingState.mode
      : null;

  // Trace-only records (silent channel.pass reasoning with empty content)
  // stay in the store for the reasoning trace but must not render as blank
  // bubbles in the timeline.
  const visibleMessages = useMemo(
    () => messages.filter((message) => !message.traceOnly),
    [messages],
  );

  return {
    messages: visibleMessages,
    approvals,
    runs,
    activity,
    selectedMember,
    status,
    loading,
    error: currentError,
    sendMessage,
    archiveConversation,
    archiving,
  };
}

export async function loadHistory(
  organizationId: string,
  threadId: string,
  signal: AbortSignal,
): Promise<Message[]> {
  const messages: Message[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ organizationId, threadId, limit: "500" });
    if (cursor) params.set("cursor", cursor);

    let body: { data?: unknown[]; hasMore?: boolean; nextCursor?: string };
    try {
      body = await clientFetchJson<{ data?: unknown[]; hasMore?: boolean; nextCursor?: string }>(
        `/api/conversations/history?${params.toString()}`,
        { signal },
        "Unable to load conversation history.",
      );
    } catch (error) {
      if (error instanceof ClientApiError && error.status === 404) return messages;
      throw error;
    }

    if (body && Array.isArray(body.data)) {
      messages.unshift(
        ...body.data.flatMap((item: unknown) => {
          const parsed = MessageSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        }),
      );
    }

    cursor = body?.hasMore && typeof body.nextCursor === "string" ? body.nextCursor : undefined;
  } while (cursor);

  return messages;
}

async function loadBootstrap(signal: AbortSignal): Promise<BootstrapResponse | null> {
  const body = await clientFetchJson<unknown>("/api/bootstrap", { signal }).catch(() => null);
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
      time: formatTimestamp(createdAt),
      content: input.chunk.delta,
      kind: "agent",
      createdAt,
      threadId: input.chunk.threadId,
      streamRunId: input.chunk.runId,
      pending: true,
    },
  };
}
