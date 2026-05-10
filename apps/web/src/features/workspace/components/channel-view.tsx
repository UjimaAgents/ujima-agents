"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildReasoningTraceSteps } from "../reasoning-trace";
import { File, FileArchive, FileAudio, FileImage, FileText, FileVideo, SquarePen } from "lucide-react";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation } from "../types";
import { useConversationSync } from "../use-conversation-sync";
import { DragHandle, WORKSPACE_MAIN_GRID_TRANSITION } from "./workspace-shell";
import {
  ChatHeader,
  ChatTabs,
  ChatMessageList,
  ChatInput,
  DetailsSidebar,
  ChatMessage,
  ApprovalCard,
  type ChatTab,
  type ChatMessageData,
} from "./chat";
import type { RunState } from "@ujima/shared";
import { getDirectMessageThreadId } from "@ujima/shared";
import { useWorkspaceStore } from "../workspace-store";
import { EmptyChat } from "./empty-chat";
import { TypingIndicator } from "./typing-indicator";
import { RunCard } from "./run-card";
import { ActivityRow } from "./activity-row";
import { ConversationSkeleton } from "./conversation-skeleton";
import { resolveWorkspaceApproval } from "../approval-resolution";
import { pendingApprovalVisibleInChannelView } from "../approval-thread-filter";
import { ReasoningTracePanel } from "./reasoning-trace-panel";

const CHANNEL_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "approvals", label: "Approvals" },
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
];

const AGENT_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "approvals", label: "Approvals" },
  { id: "tasks", label: "Tasks" },
  { id: "activity", label: "Activity" },
];

const ACTIVE_RUN_STATES: RunState["status"][] = [
  "queued",
  "running",
  "waiting_for_approval",
];

interface ChannelViewProps {
  bootstrap: BootstrapResponse;
  conversation: SelectedConversation;
  members: BootstrapResponse["members"];
  onOpenAgentEditor?: () => void;
}

export function ChannelView({
  bootstrap,
  conversation,
  members,
  onOpenAgentEditor,
}: ChannelViewProps) {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [resolvingApprovals, setResolvingApprovals] = useState<Record<string, boolean>>({});
  const [replyTo, setReplyTo] = useState<ChatMessageData | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const previousFeedSignal = useRef("");
  const feed = useConversationSync(bootstrap, conversation);
  const currentThreadId = useMemo(() => {
    const senderId = bootstrap.auth.member?.id;
    if (!senderId) return undefined;
    if (conversation.type === "agent") {
      return getDirectMessageThreadId(senderId, conversation.id);
    }
    return conversation.id;
  }, [bootstrap.auth.member?.id, conversation.id, conversation.type]);

  const reasoningTraceSteps = useMemo(() => {
    if (!currentThreadId) return [];
    return buildReasoningTraceSteps({
      threadId: currentThreadId,
      agentIdFilter: conversation.type === "agent" ? conversation.id : undefined,
      conversationName: conversation.name,
      conversationType: conversation.type,
      members: members.map((member) => ({
        id: member.id,
        name: member.name,
        kind: member.kind,
      })),
      activity: feed.activity,
      runs: feed.runs,
      organizationId: bootstrap.organization?.id,
    });
  }, [conversation.id, conversation.name, conversation.type, currentThreadId, feed.activity, feed.runs, members, bootstrap.organization?.id]);

  const pendingThreadApprovals = useMemo(
    () =>
      feed.approvals.filter((approval) =>
        pendingApprovalVisibleInChannelView(approval, conversation, currentThreadId, feed.runs),
      ),
    [conversation, currentThreadId, feed.approvals, feed.runs],
  );
  const activeTab = useWorkspaceStore((state) => state.activeTab);
  const showDetails = useWorkspaceStore((state) => state.showDetails);
  const detailsWidth = useWorkspaceStore((state) => state.detailsWidth);
  const detailsTab = useWorkspaceStore((state) => state.detailsTab);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setShowDetails = useWorkspaceStore((state) => state.setShowDetails);
  const openDetailsForAgentMessage = useWorkspaceStore((state) => state.openDetailsForAgentMessage);
  const setDetailsWidth = useWorkspaceStore((state) => state.setDetailsWidth);
  const setDetailsTab = useWorkspaceStore((state) => state.setDetailsTab);

  const isAgent = conversation.type === "agent";
  const tabs = isAgent ? AGENT_TABS : CHANNEL_TABS;
  const tabIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs]);
  const conversationColorIndex = Math.max(
    members.findIndex((member) => member.id === conversation.id),
    0,
  );
  const selectedStatus =
    conversation.type === "channel"
      ? { variant: "active" as const, label: "Active" }
      : feed.status;
  const typingRuns = useMemo(
    () =>
      !currentThreadId
        ? []
        : feed.runs.filter(
            (run) =>
              ACTIVE_RUN_STATES.includes(run.status) && run.threadId === currentThreadId,
          ),
    [currentThreadId, feed.runs],
  );
  const traceAutoScroll = useMemo(
    () => typingRuns.length > 0 && detailsTab === "Reasoning trace",
    [detailsTab, typingRuns.length],
  );
  const stoppableRunId = useMemo(() => {
    const sorted = [...typingRuns].sort((a, b) => {
      const pri = (r: RunState) =>
        r.status === "running" ? 0 : r.status === "waiting_for_approval" ? 1 : 2;
      const d = pri(a) - pri(b);
      if (d !== 0) return d;
      return (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
    });
    return sorted[0]?.id;
  }, [typingRuns]);
  const typingMembers = useMemo(() => {
    const seen = new Set<string>();
    const resolved: typeof members = [];
    for (const run of typingRuns) {
      const member = members.find((item) => item.id === run.agentId);
      if (!member || seen.has(member.id)) continue;
      seen.add(member.id);
      resolved.push(member);
    }
    return resolved;
  }, [members, typingRuns]);
  const typingLabel = useMemo(() => {
    if (!typingRuns.length) return undefined;
    const memberName =
      typingMembers[0]?.name ?? typingRuns[0]?.agentId ?? conversation.name;
    if (typingRuns.length > 1) {
      const visibleNames = typingMembers.slice(0, 3).map((member) => member.name);
      const hiddenCount = typingRuns.length - visibleNames.length;
      const tail = hiddenCount > 0 ? ` and ${hiddenCount} more` : "";
      return `${visibleNames.join(", ")}${tail} are responding`;
    }
    if (typingRuns[0].status === "waiting_for_approval") {
      return `${memberName} is waiting for approval`;
    }
    return isAgent
      ? `${conversation.name} is responding`
      : `${memberName} is responding`;
  }, [conversation.name, isAgent, typingMembers, typingRuns]);
  const typingMember = useMemo(
    () =>
      typingMembers[0] ??
      (isAgent ? members.find((member) => member.id === conversation.id) : undefined),
    [conversation.id, isAgent, members, typingMembers],
  );
  const typingColorIndex = useMemo(
    () => Math.max(members.findIndex((member) => member.id === typingMember?.id), 0),
    [members, typingMember?.id],
  );
  const mentionSuggestions = useMemo(() => {
    const currentMemberId = bootstrap.auth.member?.id;
    return members
      .filter((member) => member.id !== currentMemberId)
      .sort((a, b) => {
        if (a.kind === b.kind) return a.name.localeCompare(b.name);
        return a.kind === "agent" ? -1 : 1;
      })
      .map((member) => ({
        id: member.id,
        name: member.name,
        detail: member.roleName,
      }));
  }, [bootstrap.auth.member?.id, members]);
  const organizationId = bootstrap.organization?.id;
  const headerSubtitle =
    feed.error ?? typingLabel ?? (feed.loading ? "Syncing live history from the backend…" : undefined);
  const resolveApproval = useCallback(
    async (
      approvalId: string,
      resolution: "allow_once" | "allow_always" | "allow_family" | "reject",
    ) => {
      if (!organizationId) {
        throw new Error("Missing organization context for approval resolution.");
      }
      setResolvingApprovals((state) => ({ ...state, [approvalId]: true }));
      try {
        const response = await resolveWorkspaceApproval({
          organizationId,
          approvalId,
          resolution,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const message =
            body && typeof body === "object" && "message" in body && typeof body.message === "string"
              ? body.message
              : "Unable to resolve approval.";
          console.error(message);
        }
      } finally {
        setResolvingApprovals((state) => {
          const next = { ...state };
          delete next[approvalId];
          return next;
        });
      }
    },
    [organizationId],
  );

  const stopAgentRun = useCallback(
    async (runId: string) => {
      if (!organizationId) {
        throw new Error("Missing organization context.");
      }
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : "Unable to stop the run.";
        throw new Error(message);
      }
    },
    [organizationId],
  );

  const tabCounts = useMemo(() => {
    const activeRuns = feed.runs.filter(
      (run) =>
        run.status === "queued" ||
        run.status === "running" ||
        run.status === "waiting_for_approval",
    ).length;
    const pendingApprovals = feed.approvals.filter((approval) => approval.status === "pending").length;
    const files = feed.messages.reduce((count, message) => count + (message.attachments?.length ?? 0), 0);
    return {
      approvals: pendingApprovals,
      tasks: activeRuns,
      activity: feed.activity.length,
      files,
    };
  }, [feed.activity.length, feed.approvals, feed.messages, feed.runs]);
  const conversationAttachments = useMemo(
    () =>
      feed.messages.flatMap((message) =>
        (message.attachments ?? []).map((attachment) => ({
          ...attachment,
          messageName: message.name,
          messageTime: message.time,
          messageId: message.id,
        })),
      ),
    [feed.messages],
  );

  const blockedRunReasons = useMemo(() => {
    const reasons = new Map<string, string>();
    for (const event of feed.activity) {
      if (event.type !== "tool_result") continue;
      const body = event.payload as {
        runId?: string;
        toolResult?: { isError?: boolean; result?: unknown };
      };
      if (!body.runId || !body.toolResult?.isError) continue;
      const result = body.toolResult.result as
        | { error?: unknown; reason?: unknown }
        | string
        | undefined;
      const reason =
        typeof result === "string"
          ? result
          : typeof result?.error === "string"
            ? result.error
            : typeof result?.reason === "string"
              ? result.reason
              : undefined;
      if (!reason || reasons.has(body.runId)) continue;
      reasons.set(body.runId, reason);
    }
    return reasons;
  }, [feed.activity]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    const atBottom = distanceFromBottom < 96;
    setIsAtBottom(atBottom);
  }, []);

  useLayoutEffect(() => {
    const pendingKey = pendingThreadApprovals.map((a) => a.id).join(",");
    const signal = `${feed.messages.length}:${feed.approvals.length}:${feed.runs.length}:${feed.activity.length}:${feed.loading ? 1 : 0}:${pendingKey}`;
    if (!previousFeedSignal.current) {
      previousFeedSignal.current = signal;
      if (feed.messages.length > 0) {
        scrollToLatest("auto");
      }
      return;
    }
    if (previousFeedSignal.current === signal) return;
    previousFeedSignal.current = signal;
    if (isAtBottom) {
      scrollToLatest("smooth");
    }
  }, [feed.activity.length, feed.approvals.length, feed.loading, feed.messages.length, feed.runs.length, isAtBottom, pendingThreadApprovals, scrollToLatest]);

  useLayoutEffect(() => {
    if (!tabIds.has(activeTab)) {
      setActiveTab("conversation");
    }
  }, [activeTab, setActiveTab, tabIds]);

  const detailsCol = showDetails ? `${Math.max(detailsWidth, 33)}%` : "0px";

  return (
    <div
      className={`grid flex-1 min-h-0 overflow-hidden bg-white dark:bg-[#09090b] ${WORKSPACE_MAIN_GRID_TRANSITION}`}
      style={{ gridTemplateColumns: `minmax(0, 1fr) minmax(0, ${detailsCol})` }}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <ChatHeader
          title={conversation.name}
          type={conversation.type === "agent" ? "dm" : "channel"}
          avatarName={isAgent ? conversation.name : undefined}
          avatarColorIndex={conversationColorIndex}
          status={selectedStatus.variant}
          statusLabel={selectedStatus.label}
          subtitle={headerSubtitle}
          actions={
            isAgent ? (
              <button
                type="button"
                onClick={onOpenAgentEditor}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <SquarePen className="h-3.5 w-3.5" />
                Edit
              </button>
            ) : undefined
          }
          showDetails={showDetails}
          onToggleDetails={() => setShowDetails(!showDetails, { userIntent: true })}
        />
        <ChatTabs
          tabs={tabs.map((tab) => ({
            ...tab,
            count:
              tab.id === "approvals"
                ? tabCounts.approvals
                : tab.id === "tasks"
                  ? tabCounts.tasks
                  : tab.id === "activity"
                    ? tabCounts.activity
                    : tab.id === "files"
                      ? tabCounts.files
                      : undefined,
            countVariant: tab.id === "approvals" && tabCounts.approvals > 0 ? "warning" : "default",
          }))}
          activeTab={activeTab}
          onTabChange={(tab) => setActiveTab(tab as typeof activeTab)}
        />
        {activeTab === "conversation" ? (
          <div className="relative flex flex-1 min-h-0 flex-col">
            <ChatMessageList ref={listRef} onScroll={handleScroll}>
              {feed.loading && feed.messages.length === 0 ? (
                <ConversationSkeleton />
              ) : feed.messages.length > 0 ? (
                <>
                  {feed.messages.map((message) => (
                    <ChatMessage
                      key={message.id}
                      message={message}
                      organizationId={organizationId}
                      colorIndex={Math.max(
                        members.findIndex((member) => member.id === message.senderId),
                        0,
                      )}
                      onReply={setReplyTo}
                    />
                  ))}
                  {pendingThreadApprovals.length > 0 ? (
                    <div className="space-y-2 px-3 py-2">
                      {pendingThreadApprovals.map((approval) => (
                        <ApprovalCard
                          key={approval.id}
                          data={approval}
                          resolving={!!resolvingApprovals[approval.id]}
                          onResolve={(resolution) => resolveApproval(approval.id, resolution)}
                        />
                      ))}
                    </div>
                  ) : typingLabel ? (
                    <TypingIndicator
                      label={typingLabel}
                      name={typingMember?.name ?? conversation.name}
                      colorIndex={typingColorIndex}
                      names={typingMembers.map((member) => member.name)}
                    />
                  ) : null}
                </>
              ) : (
                <EmptyChat conversation={conversation} />
              )}
              <div ref={bottomRef} className="h-px" />
            </ChatMessageList>
          </div>
        ) : activeTab === "approvals" ? (
          feed.approvals.length > 0 ? (
            <TabPanel>
              <div className="space-y-2">
                {feed.approvals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    data={approval}
                    resolving={!!resolvingApprovals[approval.id]}
                    onResolve={(resolution) => resolveApproval(approval.id, resolution)}
                  />
                ))}
              </div>
            </TabPanel>
          ) : (
            <TabEmpty emptyLabel="No approvals." />
          )
        ) : activeTab === "tasks" ? (
          feed.runs.length > 0 ? (
            <TabPanel>
              <div className="space-y-2">
                {feed.runs.map((run) => (
                  <RunCard key={run.id} run={run} blockedReason={blockedRunReasons.get(run.id)} />
                ))}
              </div>
            </TabPanel>
          ) : (
            <TabEmpty emptyLabel="No active tasks." />
          )
        ) : activeTab === "files" ? (
          conversationAttachments.length > 0 ? (
            <TabPanel>
              <div className="space-y-2">
                {conversationAttachments.map((attachment) => {
                  const Icon = getAttachmentIcon(attachment.category);
                  return (
                    <a
                      key={attachment.id}
                      href={`/api/attachments/${encodeURIComponent(attachment.id)}?organizationId=${encodeURIComponent(organizationId ?? "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 transition hover:border-violet-500/40 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:bg-zinc-900"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-300">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          {attachment.filename}
                        </p>
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                          {attachment.messageName} · {formatAttachmentSize(attachment.sizeBytes)}
                        </p>
                      </div>
                    </a>
                  );
                })}
              </div>
            </TabPanel>
          ) : (
            <TabEmpty emptyLabel="No attachments." />
          )
        ) : (
          feed.activity.length > 0 ? (
            <TabPanel>
              <div className="space-y-2">
                {feed.activity.slice().reverse().map((event) => (
                  <ActivityRow key={event.event_id} event={event} />
                ))}
              </div>
            </TabPanel>
          ) : (
            <TabEmpty emptyLabel="No activity." />
          )
        )}
        <ChatInput
          organizationId={organizationId}
          onCommand={async (command) => {
            await feed.archiveConversation(command);
            setReplyTo(null);
          }}
          placeholder={
            isAgent
              ? `Message @${conversation.name}...`
              : `Message #${conversation.name} or @agent...`
          }
          inlineError={feed.error}
          statusHint={
            typingLabel ||
            (feed.loading ? "Syncing…" : "") ||
            "Enter to send · Shift+Enter newline"
          }
          mentionSuggestions={mentionSuggestions}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          stoppableRunId={stoppableRunId}
          onStopRun={stopAgentRun}
          onSend={(content, attachmentIds) => {
            if (isAgent) {
              openDetailsForAgentMessage();
            }
            const promise = feed.sendMessage(content, replyTo?.id, attachmentIds);
            setReplyTo(null);
            return promise;
          }}
        />
      </div>

      <div
        className={`flex h-full min-h-0 min-w-0 overflow-hidden ${showDetails ? "" : "pointer-events-none"}`}
        aria-hidden={!showDetails}
      >
        <DragHandle side="right" onResize={setDetailsWidth} />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <DetailsSidebar
            agentName={conversation.name}
            agentColorIndex={conversationColorIndex}
            statusLabel={selectedStatus.label}
            timeLabel="—"
            tabs={["Reasoning trace", "Changes", "Metadata"]}
            activeTab={detailsTab}
            onTabChange={(tab) => setDetailsTab(tab as typeof detailsTab)}
            onClose={() => setShowDetails(false, { userIntent: true })}
          >
            {detailsTab === "Reasoning trace" ? (
              <ReasoningTracePanel steps={reasoningTraceSteps} autoScroll={traceAutoScroll} />
            ) : detailsTab === "Changes" ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Diffs unavailable.</p>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">No metadata.</p>
            )}
          </DetailsSidebar>
        </div>
      </div>
    </div>
  );
}

function TabPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
      {children}
    </div>
  );
}

function TabEmpty({ emptyLabel }: { emptyLabel: string }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
      <div className="flex h-full items-center justify-center text-xs text-zinc-500">
        {emptyLabel}
      </div>
    </div>
  );
}

function getAttachmentIcon(category: string) {
  if (category === "image") return FileImage;
  if (category === "document") return FileText;
  if (category === "audio") return FileAudio;
  if (category === "video") return FileVideo;
  if (category === "archive") return FileArchive;
  return File;
}

function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
