"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageSquare, SquarePen } from "lucide-react";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation } from "../types";
import { useConversationSync } from "../use-conversation-sync";
import { DragHandle } from "./workspace-shell";
import { getDirectMessageThreadId } from "../conversation-transport";
import {
  ChatHeader,
  ChatTabs,
  ChatMessageList,
  ChatInput,
  DetailsSidebar,
  ChatMessage,
  ApprovalCard,
  type ChatTab,
} from "./chat";
import { Avatar, StatusBadge } from "./chat/primitives";
import type { RunState } from "@ujima/shared";
import { useWorkspaceStore } from "../workspace-store";

const CHANNEL_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "approvals", label: "Approvals" },
  { id: "files", label: "Files Changed" },
  { id: "activity", label: "Activity" },
];

const AGENT_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "approvals", label: "Approvals" },
  { id: "tasks", label: "Tasks" },
  { id: "activity", label: "Activity" },
];

function EmptyChat({
  conversation,
  loading,
}: {
  conversation: SelectedConversation;
  loading?: boolean;
}) {
  const isAgent = conversation.type === "agent";
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
        <MessageSquare className="h-7 w-7 text-zinc-400" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-white">
        {loading
          ? "Loading conversation…"
          : isAgent
            ? `Start a conversation with ${conversation.name}`
            : `Welcome to #${conversation.name}`}
      </h3>
      <p className="mt-1 text-xs text-zinc-500 max-w-xs text-center">
        {loading
          ? "Pulling the latest thread history and live updates."
          : isAgent
            ? "Send a message or assign a task to get started."
            : "This is the beginning of the channel. Send a message to start collaborating."}
      </p>
    </div>
  );
}

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

  const pendingThreadApprovals = useMemo(
    () =>
      feed.approvals.filter((approval) => {
        if (approval.status !== "pending") return false;
        if (!approval.runId) return false;
        const run = feed.runs.find((r) => r.id === approval.runId);
        if (!run?.threadId || !currentThreadId) return false;
        return run.threadId === currentThreadId;
      }),
    [currentThreadId, feed.approvals, feed.runs],
  );
  const activeTab = useWorkspaceStore((state) => state.activeTab);
  const showDetails = useWorkspaceStore((state) => state.showDetails);
  const detailsWidth = useWorkspaceStore((state) => state.detailsWidth);
  const detailsTab = useWorkspaceStore((state) => state.detailsTab);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setShowDetails = useWorkspaceStore((state) => state.setShowDetails);
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
    () => feed.runs.filter((run) => ACTIVE_RUN_STATES.includes(run.status)),
    [feed.runs],
  );
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
      return `${visibleNames.join(", ")}${tail} are responding…`;
    }
    if (typingRuns[0].status === "waiting_for_approval") {
      return `${memberName} is waiting for approval…`;
    }
    return isAgent
      ? `${conversation.name} is responding…`
      : `${memberName} is responding…`;
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
  const headerSubtitle =
    feed.error ?? typingLabel ?? (feed.loading ? "Syncing live history from the backend…" : undefined);
  const organizationId = bootstrap.organization?.id;

  const resolveApproval = useCallback(
    async (
      approvalId: string,
      resolution: "allow_once" | "allow_always" | "reject",
    ) => {
      if (!organizationId) {
        throw new Error("Missing organization context for approval resolution.");
      }
      const status = resolution === "reject" ? "rejected" : "approved";
      setResolvingApprovals((state) => ({ ...state, [approvalId]: true }));
      try {
        const response = await fetch(`/api/approvals/${approvalId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            status,
            resolution,
            reason: `Resolved from workspace (${resolution}).`,
          }),
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

  const tabCounts = useMemo(() => {
    const activeRuns = feed.runs.filter(
      (run) =>
        run.status === "queued" ||
        run.status === "running" ||
        run.status === "waiting_for_approval",
    ).length;
    const pendingApprovals = feed.approvals.filter((approval) => approval.status === "pending").length;
    return {
      approvals: pendingApprovals,
      tasks: activeRuns,
      activity: feed.activity.length,
      files: 0,
    };
  }, [feed.activity.length, feed.approvals, feed.runs]);

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

  return (
    <div className="flex flex-1 overflow-hidden bg-white dark:bg-[#09090b]">
      <div className="flex flex-1 min-w-0 flex-col">
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
          onToggleDetails={() => setShowDetails(!showDetails)}
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
                <ConversationSkeleton conversation={conversation} />
              ) : feed.messages.length > 0 ? (
                <>
                  {feed.messages.map((message) => (
                    <ChatMessage
                      key={message.id}
                      message={message}
                      colorIndex={Math.max(
                        members.findIndex((member) => member.id === message.senderId),
                        0,
                      )}
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
            <TabEmpty emptyLabel="No approvals yet." />
          )
        ) : activeTab === "tasks" ? (
          feed.runs.length > 0 ? (
            <TabPanel>
              <div className="space-y-2">
                {feed.runs.map((run) => (
                  <RunCard key={run.id} run={run} />
                ))}
              </div>
            </TabPanel>
          ) : (
            <TabEmpty emptyLabel="No active tasks yet." />
          )
        ) : activeTab === "files" ? (
          <TabEmpty emptyLabel="No file changes for this conversation yet." />
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
            <TabEmpty emptyLabel="No activity yet." />
          )
        )}
        <ChatInput
          placeholder={
            isAgent
              ? `Message @${conversation.name}...`
              : `Message #${conversation.name} or @agent...`
          }
          inlineError={feed.error}
          statusHint={
            typingLabel ??
            (feed.loading ? "Syncing history…" : "Enter to send, Shift+Enter for a new line.")
          }
          mentionSuggestions={mentionSuggestions}
          onSend={feed.sendMessage}
        />
      </div>

      {showDetails && (
        <>
          <DragHandle side="right" onResize={setDetailsWidth} />
          <div
            style={{ width: `${detailsWidth}%`, minWidth: 280 }}
            className="shrink-0 h-full"
          >
            <DetailsSidebar
              agentName={conversation.name}
              agentColorIndex={conversationColorIndex}
              statusLabel={selectedStatus.label}
              timeLabel="—"
              tabs={["Reasoning trace", "Changes", "Metadata"]}
              activeTab={detailsTab}
              onTabChange={(tab) => setDetailsTab(tab as typeof detailsTab)}
              onClose={() => setShowDetails(false)}
            >
              <p className="text-xs text-zinc-500">No trace data yet.</p>
            </DetailsSidebar>
          </div>
        </>
      )}
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

function RunCard({ run }: { run: RunState }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-zinc-900 dark:text-white">
            {run.summary || "Run"}
          </p>
          <p className="text-[10px] text-zinc-500">
            {run.step || run.status} · {run.agentId}
          </p>
        </div>
        <StatusBadge variant={runStatusVariant(run.status)} label={run.status} />
      </div>
    </div>
  );
}

function ActivityRow({ event }: { event: { event_id: string; type: string; publisher: string; timestamp: string; task_id?: string; payload?: unknown } }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-zinc-900 dark:text-white">{event.type}</p>
          <p className="text-[10px] text-zinc-500">
            {event.publisher}
            {event.task_id ? ` · ${event.task_id}` : ""}
          </p>
        </div>
        <span className="text-[10px] text-zinc-400">
          {formatActivityTime(event.timestamp)}
        </span>
      </div>
    </div>
  );
}

function runStatusVariant(status: RunState["status"]) {
  switch (status) {
    case "completed":
      return "active" as const;
    case "running":
      return "active" as const;
    case "waiting_for_approval":
      return "idle" as const;
    case "failed":
    case "cancelled":
      return "error" as const;
    default:
      return "idle" as const;
  }
}

function formatActivityTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "now";
  return new Date(parsed).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function ConversationSkeleton({
  conversation,
}: {
  conversation: SelectedConversation;
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className={`flex gap-3 rounded-xl border border-zinc-200 px-3 py-3 dark:border-zinc-800 ${
            index === 0 ? "bg-zinc-50 dark:bg-zinc-900/50" : "bg-white dark:bg-zinc-950"
          }`}
        >
          <div className="h-7 w-7 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-2.5 w-24 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-2.5 w-full max-w-[28rem] animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
      ))}
      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-3 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
        {conversation.type === "agent"
          ? `${conversation.name} will start appearing here as soon as the first message lands.`
          : `Live updates for #${conversation.name} will appear here as the workspace activity starts flowing.`}
      </div>
    </div>
  );
}

function TypingIndicator({
  label,
  name,
  colorIndex,
  names,
}: {
  label: string;
  name: string;
  colorIndex: number;
  names: string[];
}) {
  const visibleNames = names.slice(0, 3);
  const overflowCount = Math.max(names.length - visibleNames.length, 0);
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      {names.length > 1 ? (
        <div className="flex items-center -space-x-2">
          {visibleNames.map((visibleName, index) => (
            <Avatar
              key={`${visibleName}:${index}`}
              name={visibleName}
              colorIndex={colorIndex + index}
              size="sm"
            />
          ))}
          {overflowCount > 0 ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white text-[10px] font-bold text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              +{overflowCount}
            </div>
          ) : null}
        </div>
      ) : (
        <Avatar name={name} colorIndex={colorIndex} size="sm" />
      )}
      <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] font-medium text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
        </span>
        <span>{label}</span>
      </div>
    </div>
  );
}
