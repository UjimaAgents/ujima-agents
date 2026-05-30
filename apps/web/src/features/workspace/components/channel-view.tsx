"use client";

import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChatScrollToBottom } from "../hooks/use-chat-scroll-to-bottom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildReasoningTraceSteps } from "../reasoning-trace";
import { File, FileArchive, FileAudio, FileImage, FileText, FileVideo, SquarePen, Terminal } from "lucide-react";
import type { BootstrapResponse, SkillInvocationResponse } from "@ujima/api-schema";
import type { SelectedConversation } from "../types";
import { useConversationSync } from "../use-conversation-sync";
import { DragHandle, WORKSPACE_MAIN_GRID_TRANSITION } from "./workspace-shell";
import { TerminalDrawer } from "./chat/terminal-drawer";
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
  toSlashSkillCommands,
} from "./chat";
import { ChannelMembersTab } from "./channel-members-tab";
import { ChannelTasksTab } from "./channel-tasks-tab";
import { CultureTab } from "@/features/settings/shared/culture-tab";
import { getDirectMessageThreadId, RunStateSchema, type RunState } from "@ujima/shared/browser";
import { settingsFetch } from "@/features/settings/shared/settings-api";
import {
  isAgentOnlyThread,
  selectActiveAgentChats,
  selectActiveTerminals,
  useWorkspaceStore,
  type ActiveJob,
} from "../workspace-store";
import { EmptyChat } from "./empty-chat";
import { TypingIndicator } from "./typing-indicator";
import { RunCard } from "./run-card";
import { ActivityRow } from "./activity-row";
import { ConversationSkeleton } from "./conversation-skeleton";
import { ActivityListSkeleton } from "./activity-list-skeleton";
import { FileListSkeleton } from "./file-list-skeleton";
import { MemberListSkeleton } from "./member-list-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { resolveWorkspaceApproval } from "../approval-resolution";
import { runToActivity } from "../activity-events";
import { pendingApprovalVisibleInChannelView, queueApprovals } from "../approval-thread-filter";
import { ReasoningTracePanel } from "./reasoning-trace-panel";
import { buildTabCounts, collectBlockedRunReasons, collectConversationAttachments, isLiveRun } from "../feed-selectors";
import { ChannelGoalsStrip } from "./channel-goals-strip";
import { AgentChatHeaderControls } from "./chat/agent-chat-header-controls";
import type { Member, ShellApprovalMode } from "@ujima/shared/browser";

const CHANNEL_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "members", label: "Members" },
  { id: "approvals", label: "Approvals" },
  { id: "tasks", label: "Tasks" },
  { id: "culture", label: "Culture" },
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
];
const MAX_LIVE_TRACE_ACTIVITY = 2_000;
const MAX_ACTIVITY_ROWS = 100;
const EMPTY_ACTIVITY_EVENTS = [] as ReturnType<typeof useConversationSync>["activity"];
const EMPTY_RUNS = [] as RunState[];

const AGENT_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "approvals", label: "Approvals" },
  { id: "tasks", label: "Tasks" },
  { id: "activity", label: "Activity" },
];

interface ChannelViewProps {
  bootstrap: BootstrapResponse;
  conversation: SelectedConversation;
  members: BootstrapResponse["members"];
  orgShellApprovalMode: ShellApprovalMode;
  onOpenAgentEditor?: () => void;
  goalMode: boolean;
  onGoalModeChange: (active: boolean) => void;
  onSelectConversation?: (conv: SelectedConversation) => void;
  onMemberUpdated?: (member: Member) => void;
}

export function ChannelView({
  bootstrap,
  conversation,
  members,
  orgShellApprovalMode,
  onOpenAgentEditor,
  goalMode,
  onGoalModeChange,
  onSelectConversation,
  onMemberUpdated,
}: ChannelViewProps) {
  const [resolvingApprovals, setResolvingApprovals] = useState<Record<string, boolean>>({});
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});
  const [replyTo, setReplyTo] = useState<ChatMessageData | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const feed = useConversationSync(bootstrap, conversation);
  const activeTab = useWorkspaceStore((state) => state.activeTab);
  const showDetails = useWorkspaceStore((state) => state.showDetails);
  const detailsWidth = useWorkspaceStore((state) => state.detailsWidth);
  const detailsTab = useWorkspaceStore((state) => state.detailsTab);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setShowDetails = useWorkspaceStore((state) => state.setShowDetails);
  const openDetailsForAgentMessage = useWorkspaceStore((state) => state.openDetailsForAgentMessage);
  const setDetailsWidth = useWorkspaceStore((state) => state.setDetailsWidth);
  const setDetailsTab = useWorkspaceStore((state) => state.setDetailsTab);
  const upsertRun = useWorkspaceStore((state) => state.upsertRun);
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const memberIndexById = useMemo(
    () => new Map(members.map((member, index) => [member.id, index])),
    [members],
  );
  const channelById = useMemo(
    () => new Map(bootstrap.channels.map((channel) => [channel.id, channel])),
    [bootstrap.channels],
  );
  const currentChannel = useMemo(
    () => (conversation.type === "channel" ? channelById.get(conversation.id) : undefined),
    [channelById, conversation.id, conversation.type],
  );
  const currentThreadId = useMemo(() => {
    const senderId = bootstrap.auth.member?.id;
    if (!senderId) return undefined;
    if (conversation.type === "agent") {
      return getDirectMessageThreadId(senderId, conversation.id);
    }
    return conversation.id;
  }, [bootstrap.auth.member?.id, conversation.id, conversation.type]);
  const skillCommands = useMemo(
    () => toSlashSkillCommands(bootstrap.skills ?? []),
    [bootstrap.skills],
  );
  const isReadOnly = useMemo(() => {
    const currentMemberId = bootstrap.auth.member?.id;
    if (!currentMemberId) return false;
    if (currentThreadId && isAgentOnlyThread(currentThreadId, { channels: bootstrap.channels, members })) {
      return true;
    }
    if (conversation.type === "channel") {
      const channel = channelById.get(conversation.id);
      if (channel && channel.memberIds) {
        return !channel.memberIds.includes(currentMemberId);
      }
    }
    return false;
  }, [bootstrap.auth.member?.id, bootstrap.channels, conversation.id, conversation.type, currentThreadId, channelById, members]);
  const [channelMemberIds, setChannelMemberIds] = useState<string[]>(
    () => currentChannel?.memberIds ?? [],
  );

  // Sync with currentChannel.memberIds when updated externally (SSE, etc.)
  useEffect(() => {
    setChannelMemberIds((prev) => {
      const next = currentChannel?.memberIds ?? [];
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      return next;
    });
  }, [currentChannel?.memberIds]);

  const globalActiveRuns = useWorkspaceStore((state) => state.globalActiveRuns);
  const activeAgentChats = useMemo(
    () => selectActiveAgentChats({ channels: bootstrap.channels, members, globalActiveRuns }, currentThreadId),
    [bootstrap.channels, currentThreadId, globalActiveRuns, members],
  );
  const activeTerminals = useWorkspaceStore(selectActiveTerminals);
  const setActiveTerminals = useWorkspaceStore((state) => state.setActiveTerminals);
  const [isTerminalDrawerOpen, setIsTerminalDrawerOpen] = useState(false);

  useEffect(() => {
    const organizationId = bootstrap.organization?.id;
    if (!organizationId || globalActiveRuns.length === 0) {
      setActiveTerminals([]);
      return;
    }

    let cancelled = false;
    const pollJobs = async () => {
      try {
        const jobsPromises = globalActiveRuns.map(async (run) => {
          const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/jobs?organizationId=${encodeURIComponent(organizationId)}`);
          if (!res.ok) return [];
          const data = await res.json().catch(() => []);
          if (!Array.isArray(data)) return [];
          return data.flatMap((job: unknown) => {
            if (!job || typeof job !== "object") return [];
            const record = job as Record<string, unknown>;
            if (typeof record.id !== "string") return [];
            return [
              {
                runId: run.id,
                jobId: record.id,
                commandLine: typeof record.commandLine === "string" ? record.commandLine : "",
                cwd: typeof record.cwd === "string" ? record.cwd : "",
                status: typeof record.status === "string" ? record.status : "running",
              } satisfies ActiveJob,
            ];
          });
        });

        const allJobsLists = await Promise.all(jobsPromises);
        if (cancelled) return;

        const runningJobs = allJobsLists.flat().filter((job) => job.status === "running");
        setActiveTerminals(runningJobs);
      } catch (e) {
        console.error("Failed to fetch running background jobs:", e);
      }
    };

    void pollJobs();
    const interval = setInterval(pollJobs, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [globalActiveRuns, bootstrap.organization?.id, setActiveTerminals]);

  const traceMembers = useMemo(
    () =>
      members.map((member) => ({
        id: member.id,
        name: member.name,
        kind: member.kind,
      })),
    [members],
  );
  const reasoningTraceVisible = showDetails && detailsTab === "Reasoning trace";
  const liveTraceActivity = useMemo(
    () => (reasoningTraceVisible ? feed.activity.slice(-MAX_LIVE_TRACE_ACTIVITY) : []),
    [feed.activity, reasoningTraceVisible],
  );
  const liveTraceRuns = useMemo(
    () => (reasoningTraceVisible ? feed.runs : []),
    [feed.runs, reasoningTraceVisible],
  );
  const deferredTraceActivity = useDeferredValue(liveTraceActivity);
  const deferredTraceRuns = useDeferredValue(liveTraceRuns);
  const reasoningTraceState = useMemo(
    () => (reasoningTraceVisible ? { activity: deferredTraceActivity, runs: deferredTraceRuns } : null),
    [deferredTraceActivity, deferredTraceRuns, reasoningTraceVisible],
  );
  const reasoningTraceSteps = useMemo(() => {
    if (!currentThreadId || !reasoningTraceVisible || !reasoningTraceState) return [];
    return buildReasoningTraceSteps({
      threadId: currentThreadId,
      agentIdFilter: conversation.type === "agent" ? conversation.id : undefined,
      conversationName: conversation.name,
      conversationType: conversation.type,
      members: traceMembers,
      activity: reasoningTraceState.activity,
      runs: reasoningTraceState.runs,
      organizationId: bootstrap.organization?.id,
    });
  }, [
    bootstrap.organization?.id,
    conversation.id,
    conversation.name,
    conversation.type,
    currentThreadId,
    reasoningTraceVisible,
    reasoningTraceState,
    traceMembers,
  ]);

  const approvalsSource = activeTab === "conversation" || activeTab === "approvals" ? feed.approvals : null;
  const visibleApprovals = useMemo(
    () => (approvalsSource ? queueApprovals(approvalsSource) : []),
    [approvalsSource],
  );
  const pendingThreadApprovals = useMemo(
    () =>
      activeTab === "conversation"
        ? visibleApprovals.filter((approval) =>
            pendingApprovalVisibleInChannelView(approval, conversation, currentThreadId, feed.runs),
          )
        : [],
    [activeTab, conversation, currentThreadId, feed.runs, visibleApprovals],
  );

  const isAgent = conversation.type === "agent";
  const agentMember = isAgent ? memberById.get(conversation.id) : undefined;
  const tabs = isAgent ? AGENT_TABS : CHANNEL_TABS;
  const tabIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs]);
  const conversationColorIndex = Math.max(memberIndexById.get(conversation.id) ?? 0, 0);
  // eslint-disable-next-line react-hooks/incompatible-library
  const messageVirtualizer = useVirtualizer({
    count: feed.messages.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index: number) => {
      const msg = feed.messages[index];
      if (!msg) return 80;
      // Base row: avatar row + padding ~ 48px
      let height = 48;
      // Text content: ~18px per line of 80 chars
      const textLen = msg.content?.length ?? 0;
      const lines = Math.max(1, Math.ceil(textLen / 80));
      height += lines * 18;
      // Code blocks: ~24px per marker pair
      const codeFences = (msg.content?.match(/```/g)?.length ?? 0) / 2;
      height += codeFences * 60;
      // Attachments: ~40px each
      height += (msg.attachments?.length ?? 0) * 40;
      // Tool calls: ~24px each
      height += (msg.toolCalls?.length ?? 0) * 24;
      return Math.max(64, Math.min(400, height));
    },
    overscan: 8,
  });
  const virtualMessageRows = messageVirtualizer.getVirtualItems();

  const latestMessageSignal = useMemo(() => {
    const last = feed.messages.at(-1);
    if (!last) return "";
    return [
      last.id,
      last.createdAt ?? "",
      last.content.length,
      last.pending ? 1 : 0,
      last.streamRunId ?? "",
    ].join(":");
  }, [feed.messages]);

  const pendingApprovalIds = useMemo(
    () => pendingThreadApprovals.map((a) => a.id).join(","),
    [pendingThreadApprovals],
  );

  const { scrollToLatest, handleScroll } = useChatScrollToBottom({
    listRef,
    bottomRef,
    feed,
    latestMessageSignal,
    pendingApprovalIds,
    conversationKey: `${conversation.id}:${conversation.type}`,
    virtualizerTotalSize: messageVirtualizer.getTotalSize(),
  });

  const selectedStatus =
    conversation.type === "channel"
      ? { variant: "active" as const, label: "Active" }
      : feed.status;
  const liveThreadRuns = useMemo(() => {
    if (!currentThreadId) return EMPTY_RUNS;
    return feed.runs.filter((run) => isLiveRun(run) && run.threadId === currentThreadId);
  }, [currentThreadId, feed.runs]);
  const typingRuns = activeTab === "conversation" ? liveThreadRuns : EMPTY_RUNS;
  const taskRuns = activeTab === "tasks" ? liveThreadRuns : EMPTY_RUNS;
  const activeStep = useMemo(() => {
    const running = typingRuns.find((r) => r.status === "running");
    const s = running?.step;
    if (!s || s.toLowerCase() === "running") return undefined;
    return s;
  }, [typingRuns]);
  const traceAutoScroll = reasoningTraceVisible && typingRuns.length > 0;
  const stoppableRunIds = useMemo(() => {
    const sorted = [...liveThreadRuns].sort((a, b) => {
      const pri = (r: RunState) =>
        r.status === "running" ? 0 : r.status === "waiting_for_approval" ? 1 : 2;
      const d = pri(a) - pri(b);
      if (d !== 0) return d;
      return (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
    });
    return sorted.map((run) => run.id);
  }, [liveThreadRuns]);
  const typingMembers = useMemo(() => {
    const seen = new Set<string>();
    const resolved: typeof members = [];
    for (const run of typingRuns) {
      const member = memberById.get(run.agentId);
      if (!member || seen.has(member.id)) continue;
      seen.add(member.id);
      resolved.push(member);
    }
    return resolved;
  }, [memberById, typingRuns]);
  const typingLabel = useMemo(() => {
    if (activeTab !== "conversation" || !typingRuns.length) return undefined;
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
  }, [activeTab, conversation.name, isAgent, typingMembers, typingRuns]);
  const typingMember = useMemo(
    () => typingMembers[0] ?? (isAgent ? memberById.get(conversation.id) : undefined),
    [conversation.id, isAgent, memberById, typingMembers],
  );
  const typingColorIndex = useMemo(
    () => Math.max(memberIndexById.get(typingMember?.id ?? "") ?? 0, 0),
    [memberIndexById, typingMember?.id],
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
      setApprovalErrors((state) => {
        const next = { ...state };
        delete next[approvalId];
        return next;
      });
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
          setApprovalErrors((state) => ({ ...state, [approvalId]: message }));
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
      const parsed = RunStateSchema.safeParse(body);
      if (parsed.success) {
        upsertRun(parsed.data, runToActivity);
      }
    },
    [organizationId, upsertRun],
  );
  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab as typeof activeTab);
    },
    [setActiveTab],
  );

  const tabCounts = useMemo(
    () =>
      buildTabCounts({
        activity: feed.activity,
        approvals: feed.approvals,
        messages: feed.messages,
        runs: feed.runs,
      }),
    [feed.activity, feed.approvals, feed.messages, feed.runs],
  );
  const tabsWithCounts = useMemo(
    () =>
      tabs.map((tab) => ({
        ...tab,
        count:
          tab.id === "approvals"
            ? tabCounts.approvals
            : tab.id === "files"
              ? tabCounts.files
              : tab.id === "activity"
                ? tabCounts.activity
                : tab.id === "members"
                  ? channelMemberIds.length
                  : tab.id === "tasks"
                    ? tabCounts.tasks
                    : undefined,
        countVariant:
          tab.id === "approvals" && tabCounts.approvals > 0 ? ("warning" as const) : ("default" as const),
      })),
    [channelMemberIds.length, tabCounts.activity, tabCounts.approvals, tabCounts.files, tabCounts.tasks, tabs],
  );
  const conversationAttachmentsSource = activeTab === "files" ? feed.messages : null;
  const conversationAttachments = useMemo(
    () => (conversationAttachmentsSource ? collectConversationAttachments(conversationAttachmentsSource) : []),
    [conversationAttachmentsSource],
  );

  const blockedRunActivity = activeTab === "tasks" ? feed.activity : null;
  const blockedRunReasons = useMemo(
    () => (blockedRunActivity ? collectBlockedRunReasons(blockedRunActivity) : new Map<string, string>()),
    [blockedRunActivity],
  );
  const visibleActivity = useMemo(
    () =>
      activeTab === "activity"
        ? feed.activity.slice(-MAX_ACTIVITY_ROWS).reverse()
        : EMPTY_ACTIVITY_EVENTS,
    [activeTab, feed.activity],
  );

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
            isAgent && agentMember && onMemberUpdated ? (
              <div className="flex items-center gap-2">
                <AgentChatHeaderControls
                  orgId={organizationId ?? bootstrap.organization?.id ?? ""}
                  member={agentMember}
                  providers={bootstrap.providers}
                  orgShellApprovalMode={orgShellApprovalMode}
                  goalMode={goalMode}
                  onMemberUpdated={onMemberUpdated}
                />
                {onOpenAgentEditor ? (
                  <button
                    type="button"
                    onClick={onOpenAgentEditor}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <SquarePen className="h-3.5 w-3.5" />
                    Edit
                  </button>
                ) : null}
              </div>
            ) : undefined
          }
          showDetails={showDetails}
          onToggleDetails={() => setShowDetails(!showDetails, { userIntent: true })}
        />
        <ChatTabs
          tabs={tabsWithCounts}
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />
        {conversation.type === "channel" && organizationId ? (
          <ChannelGoalsStrip
            organizationId={organizationId}
            channelId={conversation.id}
            memberNameLookup={(memberId) => memberById.get(memberId)?.name}
          />
        ) : null}
        {activeTab === "conversation" ? (
          <div className="relative flex flex-1 min-h-0 flex-col">
            <ChatMessageList ref={listRef} onScroll={handleScroll}>
            {feed.loading && feed.messages.length === 0 ? (
              <ConversationSkeleton />
            ) : feed.messages.length > 0 ? (
              <>
                  <div
                    className="relative w-full"
                    style={{ height: `${messageVirtualizer.getTotalSize()}px` }}
                  >
                    {virtualMessageRows.map((virtualRow) => {
                      const message = feed.messages[virtualRow.index];
                      if (!message) return null;
                      return (
                        <div
                          key={message.id}
                          data-index={virtualRow.index}
                          ref={messageVirtualizer.measureElement}
                          className="absolute left-0 top-0 w-full pb-2"
                          style={{
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <ChatMessage
                            message={message}
                            organizationId={organizationId}
                            colorIndex={Math.max(memberIndexById.get(message.senderId ?? "") ?? 0, 0)}
                            onReply={setReplyTo}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {typingLabel ? (
                    <TypingIndicator
                      label={typingLabel}
                      name={typingMember?.name ?? conversation.name}
                      colorIndex={typingColorIndex}
                      names={typingMembers.map((member) => member.name)}
                      activeStep={activeStep}
                    />
                  ) : null}
                </>
              ) : (
                <EmptyChat conversation={conversation} />
              )}
              <div ref={bottomRef} className="h-px" />
            </ChatMessageList>
          </div>
        ) : activeTab === "members" ? (
          currentChannel ? (
            <ChannelMembersTab
              organizationId={organizationId}
              channel={{ ...currentChannel, memberIds: channelMemberIds }}
              members={members}
              onSaved={setChannelMemberIds}
            />
          ) : feed.loading ? (
            <TabPanel><MemberListSkeleton /></TabPanel>
          ) : (
            <TabEmpty context="members" label="Channel unavailable." />
          )
        ) : activeTab === "approvals" ? (
          feed.loading ? (
            <TabPanel><MemberListSkeleton /></TabPanel>
          ) : visibleApprovals.length > 0 ? (
            <TabPanel>
              <div className="space-y-2">
                {visibleApprovals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    data={{ ...approval, error: approvalErrors[approval.id] }}
                    resolving={!!resolvingApprovals[approval.id]}
                    onResolve={(resolution) => resolveApproval(approval.id, resolution)}
                  />
                ))}
              </div>
            </TabPanel>
          ) : (
            <TabEmpty context="approvals" label="No approvals." />
          )
        ) : activeTab === "tasks" ? (
          conversation.type === "channel" && organizationId ? (
            // Channel context — render the per-channel commitments
            // management surface (in_progress / blocked / completed /
            // expired with human-driven status overrides). The agent
            // context below keeps the legacy "live runs" view.
            <TabPanel>
              <ChannelTasksTab
                organizationId={organizationId}
                channelId={conversation.id}
                memberNameLookup={(memberId) => memberById.get(memberId)?.name}
              />
            </TabPanel>
          ) : taskRuns.length > 0 ? (
            <TabPanel>
              <div className="space-y-2">
                {taskRuns.map((run) => (
                  <RunCard key={run.id} run={run} blockedReason={blockedRunReasons.get(run.id)} />
                ))}
              </div>
            </TabPanel>
          ) : (
            <TabEmpty context="tasks" label="No active tasks." />
          )
        ) : activeTab === "culture" ? (
          conversation.type === "channel" && organizationId ? (
            <TabPanel>
              <CultureTab organizationId={organizationId} channelId={conversation.id} />
            </TabPanel>
          ) : (
            <TabEmpty context="generic" label="Channel culture is only available in channels." />
          )
        ) : activeTab === "files" ? (
          feed.loading ? (
            <TabPanel><FileListSkeleton /></TabPanel>
          ) : conversationAttachments.length > 0 ? (
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
            <TabEmpty context="files" label="No attachments." />
          )
        ) : (
          feed.loading ? (
            <TabPanel><ActivityListSkeleton /></TabPanel>
          ) : visibleActivity.length > 0 ? (
            <TabPanel>
              <div className="space-y-2">
                {visibleActivity.map((event) => (
                  <ActivityRow key={event.event_id} event={event} />
                ))}
              </div>
            </TabPanel>
          ) : (
            <TabEmpty context="activity" label="No activity." />
          )
        )}
        {(activeAgentChats.length > 0 || activeTerminals.length > 0) && (
          <div className="relative z-20 flex shrink-0 flex-wrap gap-2 px-3 pb-1.5 pt-1 animate-in slide-in-from-bottom-2 duration-300">
            {activeAgentChats.map((chat) => (
              <button
                key={chat.threadId}
                type="button"
                onClick={() => {
                  handleTabChange("conversation");
                  onSelectConversation?.({
                    type: "channel",
                    id: chat.threadId,
                    name: chat.name,
                  });
                }}
                className="flex items-center gap-2 rounded-full border border-violet-500/30 bg-zinc-950/80 px-3.5 py-1.5 text-xs text-zinc-100 shadow-lg backdrop-blur-md transition hover:bg-zinc-900/95 dark:border-violet-500/20"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="font-medium">
                  {chat.agents.join(" & ")} {chat.agents.length > 1 ? "are" : "is"} chatting
                </span>
              </button>
            ))}

            {activeTerminals.length > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsTerminalDrawerOpen(true)}
                  className="flex items-center gap-2 rounded-full border border-violet-500/20 bg-zinc-950/85 px-3.5 py-1.5 text-xs font-semibold text-zinc-100 shadow-lg shadow-black/20 backdrop-blur-md transition hover:bg-zinc-900/95 dark:border-violet-500/20 dark:bg-zinc-950/90 dark:text-zinc-100 dark:hover:bg-zinc-900/95"
                >
                  <Terminal className="h-3.5 w-3.5 animate-pulse text-zinc-400" />
                  <span>
                    {activeTerminals.length} {activeTerminals.length === 1 ? "Terminal" : "Terminals"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsTerminalDrawerOpen(true)}
                  className="flex h-[29px] w-[29px] items-center justify-center rounded-full border border-violet-500/20 bg-zinc-950/85 text-zinc-400 shadow-lg shadow-black/20 transition hover:bg-zinc-900/95 dark:border-violet-500/20 dark:bg-zinc-950/90 dark:text-zinc-400 dark:hover:bg-zinc-900/95"
                  aria-label="More terminal details"
                >
                  <span className="text-xs font-semibold">...</span>
                </button>
              </div>
            )}
          </div>
        )}
        {pendingThreadApprovals.length > 0 ? (
          <div className="shrink-0 px-3 pt-1.5 pb-3">
            <div className="space-y-2">
              {pendingThreadApprovals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  data={{ ...approval, error: approvalErrors[approval.id] }}
                  resolving={!!resolvingApprovals[approval.id]}
                  onResolve={(resolution) => resolveApproval(approval.id, resolution)}
                />
              ))}
            </div>
          </div>
        ) : (
          <ChatInput
            organizationId={organizationId}
            goalMode={goalMode}
            onGoalModeChange={onGoalModeChange}
            readOnly={isReadOnly}
            skillCommands={skillCommands}
            onSkillCommand={async (skillId, content) => {
              if (!organizationId) throw new Error("Missing organization context.");
              const { content: skillContent } = await settingsFetch<SkillInvocationResponse>(
                `/api/settings/skills/${encodeURIComponent(skillId)}?organizationId=${encodeURIComponent(organizationId)}&arguments=${encodeURIComponent(content ?? "")}`,
                undefined,
                "Unable to load skill.",
              );
              await feed.sendMessage(skillContent);
              setReplyTo(null);
              scrollToLatest("auto");
            }}
            onCommand={async (command, content) => {
              if (command === "schedule") {
                const prompt = content?.replace(/^\/schedule\s*/i, "").trim();
                if (!prompt) {
                  throw new Error("Usage: /schedule do this");
                }
                await feed.sendMessage(`Please use the schedule tool for this request: ${prompt}`);
                setReplyTo(null);
                scrollToLatest("auto");
                return;
              }
              await feed.archiveConversation(command);
              setReplyTo(null);
              scrollToLatest("auto");
            }}
            placeholder={
              isAgent
                ? `Message @${conversation.name}...`
                : `Message #${conversation.name} or @agent...`
            }
            inlineError={feed.error}
            mentionSuggestions={mentionSuggestions}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            stoppableRunIds={stoppableRunIds}
            onStopRun={stopAgentRun}
            onSend={(content, attachmentIds, metadata) => {
              if (isAgent) {
                openDetailsForAgentMessage();
              }
              const promise = feed.sendMessage(content, replyTo?.id, attachmentIds, metadata);
              setReplyTo(null);
              return promise;
            }}
          />
        )}
      </div>

      <div
        className={`flex h-full min-h-0 min-w-0 overflow-hidden border-l border-zinc-200 dark:border-zinc-800 ${showDetails ? "" : "pointer-events-none"}`}
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
              <ReasoningTracePanel
                key={`${currentThreadId ?? conversation.id}:${reasoningTraceSteps.length > 0 ? "live" : "history"}`}
                organizationId={bootstrap.organization?.id}
                threadId={currentThreadId}
                conversationName={conversation.name}
                conversationType={conversation.type}
                members={traceMembers}
                liveSteps={reasoningTraceSteps}
                autoScroll={traceAutoScroll}
              />
            ) : detailsTab === "Changes" ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Diffs unavailable.</p>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">No metadata.</p>
            )}
          </DetailsSidebar>
        </div>
      </div>
      <TerminalDrawer
        isOpen={isTerminalDrawerOpen}
        onClose={() => setIsTerminalDrawerOpen(false)}
        jobs={activeTerminals}
        organizationId={organizationId ?? ""}
      />
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

function TabEmpty({ context, label }: { context?: "messages" | "members" | "approvals" | "tasks" | "files" | "activity" | "search" | "generic"; label?: string }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
      <EmptyState context={context ?? "generic"} title={label} />
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
