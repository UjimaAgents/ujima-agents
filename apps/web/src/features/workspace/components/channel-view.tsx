"use client";

import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChatScrollToBottom } from "../hooks/use-chat-scroll-to-bottom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { File, FileArchive, FileAudio, FileImage, FileText, FileVideo, Loader2, Square, Terminal } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation } from "../types";
import { useConversationSync } from "../use-conversation-sync";
import type { ConversationMessageMetadata } from "../conversation-transport";
import { DragHandle, WORKSPACE_MAIN_GRID_TRANSITION } from "./workspace-shell";
import { TerminalDrawer } from "./chat/terminal-drawer";
import {
  ChatTabs,
  ChatMessageList,
  ChatInput,
  ChangesTab,
  CollapsibleHeaderActions,
  DetailsSidebar,
  ChatMessage,
  ApprovalQueue,
  type ChatTab,
  type ChatMessageData,
} from "./chat";
import { ChannelMembersTab } from "./channel-members-tab";
import { ChannelWorkflowsTab } from "@/features/workflows/channel-workflows-tab";
import { CultureTab } from "@/features/settings/shared/culture-tab";
import {
  getDirectMessageThreadId,
  parseConfiguredProviderModelValue,
  resolveMemberModelSelection,
  RunStateSchema,
  type ReasoningEffort,
  type RunState,
} from "@ujima/shared/browser";
import {
  isAgentOnlyThread,
  selectActiveAgentChats,
  useWorkspaceStore,
  type ActiveJob,
} from "../workspace-store";
import { EmptyChat } from "./empty-chat";
import { TypingIndicator } from "./typing-indicator";
import { ActivityRow } from "./activity-row";
import { ChannelGoalsBoard } from "./channel-goals-board";
import { ListSkeleton } from "./list-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useApprovalResolution } from "../hooks/use-approval-resolution";
import { useThreadQuestions } from "../hooks/use-thread-questions";
import { useActiveTerminalJobs } from "../hooks/use-active-terminal-jobs";
import { clientFetchJson } from "@/lib/client-api";
import { runToActivity } from "../activity-events";
import { pendingApprovalVisibleInChannelView, queueApprovals } from "../approval-thread-filter";
import { summarizeFileChanges } from "../change-summary";
import { ReasoningTracePanel } from "./reasoning-trace-panel";
import { QuestionCard } from "./chat/question-card";
import {
  buildTabCounts,
  collectConversationAttachments,
  countMessageAttachments,
  countSemanticActivityEvents,
  isSidebarActivityEvent,
  isLiveRun,
} from "../feed-selectors";
import { buildReasoningTraceSteps } from "../reasoning-trace";
import type { Member, ShellApprovalMode } from "@ujima/shared/browser";

const CHANNEL_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "members", label: "Members" },
  { id: "approvals", label: "Approvals" },
  { id: "tasks", label: "Tasks" },
  { id: "workflows", label: "Workflows" },
  { id: "culture", label: "Culture" },
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
];
const MAX_ACTIVITY_ROWS = 100;
const ACTIVITY_PAGE_SIZE = 50;
const EMPTY_ACTIVITY_EVENTS = [] as ReturnType<typeof useConversationSync>["activity"];
const EMPTY_RUNS = [] as RunState[];

type ActivityFilter = "all" | "runs" | "tools" | "approvals";

const ACTIVITY_FILTER_MATCHERS: Record<Exclude<ActivityFilter, "all">, (type: string) => boolean> = {
  runs: (type) => type.startsWith("run_") || type.startsWith("member_alert"),
  tools: (type) => type.startsWith("tool_") || type === "run_chunk",
  approvals: (type) => type.startsWith("approval_"),
};

function calendarDayLabel(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(parsed)) / (24 * 60 * 60 * 1000));
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: parsed.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(parsed);
}

const AGENT_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "approvals", label: "Approvals" },
  { id: "tasks", label: "Tasks" },
  { id: "workflows", label: "Workflows" },
  { id: "activity", label: "Activity" },
];

interface FloatingStatusRailProps {
  channels: BootstrapResponse["channels"];
  members: BootstrapResponse["members"];
  currentThreadId?: string;
  activeTerminals: ActiveJob[];
  onOpenChat: (threadId: string, name: string) => void;
  onOpenTerminal: () => void;
}

function FloatingStatusRail({
  channels,
  members,
  currentThreadId,
  activeTerminals,
  onOpenChat,
  onOpenTerminal,
}: FloatingStatusRailProps) {
  const { globalActiveRuns, approvals, activity } = useWorkspaceStore(
    useShallow((state) => ({
      globalActiveRuns: state.globalActiveRuns,
      approvals: state.approvals,
      activity: state.activity,
    })),
  );
  const activeAgentChats = useMemo(
    () => selectActiveAgentChats({
      channels,
      members,
      globalActiveRuns,
      approvals,
      activity,
    }, currentThreadId),
    [activity, approvals, channels, currentThreadId, globalActiveRuns, members],
  );

  if (activeAgentChats.length === 0 && activeTerminals.length === 0) return null;

  return (
    <div className="relative z-20 flex shrink-0 flex-wrap gap-2 px-3 pb-1.5 pt-1 animate-in slide-in-from-bottom-2 duration-300">
      {activeAgentChats.map((chat) => (
        <button
          key={chat.threadId}
          type="button"
          onClick={() => onOpenChat(chat.threadId, chat.name)}
          className="flex max-w-[min(32rem,100%)] items-center gap-2 rounded-full border border-zinc-200 bg-white/90 px-3.5 py-1.5 text-xs text-zinc-800 shadow-lg backdrop-blur-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-200"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {chat.name} {chat.agents.length > 1 ? "are" : "is"} chatting
            </span>
            {chat.activityText ? (
              <span className="live-activity-shimmer block truncate text-xs leading-tight">
                {chat.activityText}
              </span>
            ) : null}
          </span>
          {chat.pendingApprovals > 0 ? (
            <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-zinc-950">
              {chat.pendingApprovals} approval{chat.pendingApprovals === 1 ? "" : "s"}
            </span>
          ) : null}
        </button>
      ))}
      {activeTerminals.length > 0 ? (
        <button
          type="button"
          onClick={onOpenTerminal}
          className="flex shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-zinc-800 shadow-lg backdrop-blur-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-200"
        >
          <Terminal className="h-3.5 w-3.5 animate-pulse text-zinc-500 dark:text-zinc-400" />
          <span>
            {activeTerminals.length} {activeTerminals.length === 1 ? "Terminal" : "Terminals"}
          </span>
        </button>
      ) : null}
    </div>
  );
}

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
  onOrgShellApprovalModeChange?: (value: ShellApprovalMode) => Promise<void> | void;
}

function readReplyDraft(key: string): ChatMessageData | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(`ujima.replyDraft.${key}`) ?? "null") as Partial<ChatMessageData> | null;
    return value && typeof value.id === "string" && typeof value.name === "string" && typeof value.content === "string"
      ? { id: value.id, name: value.name, content: value.content, role: value.role ?? "", time: value.time ?? "", kind: value.kind }
      : null;
  } catch {
    return null;
  }
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
  onOrgShellApprovalModeChange,
}: ChannelViewProps) {
  const organizationId = bootstrap.organization?.id;
  const { resolve: resolveApproval, resolving: resolvingApprovals, errors: approvalErrors } =
    useApprovalResolution(organizationId);
  const [resolvingQuestions, setResolvingQuestions] = useState<Record<string, boolean>>({});
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});
  const [stoppingRunId, setStoppingRunId] = useState<string | undefined>();
  const replyDraftKey = `${bootstrap.organization?.id ?? ""}:${conversation.type}:${conversation.id}`;
  const [replyTo, setReplyTo] = useState<ChatMessageData | null>(() => readReplyDraft(replyDraftKey));
  const [scheduleMode, setScheduleMode] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const feed = useConversationSync(bootstrap, conversation);
  const activeTab = useWorkspaceStore((state) => state.activeTab);
  const showDetails = useWorkspaceStore((state) => state.showDetails);
  const detailsWidth = useWorkspaceStore((state) => state.detailsWidth);
  const detailsTab = useWorkspaceStore((state) => state.detailsTab);
  const chatFontSize = useWorkspaceStore((state) => state.chatFontSize);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `ujima.replyDraft.${replyDraftKey}`;
    if (!replyTo) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, JSON.stringify({
      id: replyTo.id,
      name: replyTo.name,
      content: replyTo.content,
      role: replyTo.role,
      time: replyTo.time,
      kind: replyTo.kind,
    }));
  }, [replyDraftKey, replyTo]);

  const {
    setActiveTab,
    setShowDetails,
    openDetailsForAgentMessage,
    setDetailsWidth,
    setDetailsTab,
    setChatFontSize,
    upsertRun,
  } = useWorkspaceStore(
    useShallow((state) => ({
      setActiveTab: state.setActiveTab,
      setShowDetails: state.setShowDetails,
      openDetailsForAgentMessage: state.openDetailsForAgentMessage,
      setDetailsWidth: state.setDetailsWidth,
      setDetailsTab: state.setDetailsTab,
      setChatFontSize: state.setChatFontSize,
      upsertRun: state.upsertRun,
    }))
  );

  useEffect(() => {
    setScheduleMode(false);
  }, [conversation.id, conversation.type]);

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
  const currentMember = useMemo(
    () => (bootstrap.auth.member ? memberById.get(bootstrap.auth.member.id) ?? bootstrap.auth.member : undefined),
    [bootstrap.auth.member, memberById],
  );
  const reasoningMember = conversation.type === "agent" ? feed.selectedMember ?? undefined : currentMember;
  const reasoningModelSelection = useMemo(() => {
    if (!reasoningMember) return undefined;
    const selectedModel = resolveMemberModelSelection(reasoningMember);
    return parseConfiguredProviderModelValue(selectedModel) ?? undefined;
  }, [reasoningMember]);
  const currentThreadId = useMemo(() => {
    const senderId = bootstrap.auth.member?.id;
    if (!senderId) return undefined;
    if (conversation.type === "agent") {
      return getDirectMessageThreadId(senderId, conversation.id);
    }
    return conversation.id;
  }, [bootstrap.auth.member?.id, conversation.id, conversation.type]);

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
  const activeTerminals = useActiveTerminalJobs(globalActiveRuns, organizationId);
  const composerReasoningEffort =
    useWorkspaceStore((state) =>
      currentThreadId ? state.composerReasoningEffortByThread[currentThreadId] : undefined,
    );
  const setComposerReasoningEffort = useWorkspaceStore((state) => state.setComposerReasoningEffort);
  const [isTerminalDrawerOpen, setIsTerminalDrawerOpen] = useState(false);
  const openWorkflowRunDrawer = useWorkspaceStore((s) => s.openWorkflowRunDrawer);
  const [stopError, setStopError] = useState<string | undefined>(undefined);

  const traceMembers = useMemo(
    () =>
      members.map((member) => ({
        id: member.id,
        name: member.name,
        kind: member.kind,
      })),
    [members],
  );
  const reasoningTraceVisible = showDetails;
  const liveTraceActivity = useMemo(
    () => (reasoningTraceVisible ? feed.activity : []),
    [feed.activity, reasoningTraceVisible],
  );
  const liveTraceRuns = useMemo(
    () => (reasoningTraceVisible ? feed.runs : []),
    [feed.runs, reasoningTraceVisible],
  );
  const deferredTraceActivity = useDeferredValue(liveTraceActivity);
  const deferredTraceRuns = useDeferredValue(liveTraceRuns);
  const reasoningTraceSteps = useMemo(() => {
    if (!currentThreadId || !reasoningTraceVisible) return [];
    return buildReasoningTraceSteps({
      threadId: currentThreadId,
      agentIdFilter: conversation.type === "agent" ? conversation.id : undefined,
      conversationName: conversation.name,
      conversationType: conversation.type,
      members: traceMembers,
      activity: deferredTraceActivity,
      runs: deferredTraceRuns,
      organizationId,
    });
  }, [
    currentThreadId,
    reasoningTraceVisible,
    conversation.id,
    conversation.name,
    conversation.type,
    traceMembers,
    deferredTraceActivity,
    deferredTraceRuns,
    organizationId,
  ]);

  const approvalsSource = activeTab === "conversation" || activeTab === "approvals" ? feed.approvals : null;
  const visibleApprovals = useMemo(
    () =>
      approvalsSource
        ? queueApprovals(approvalsSource.filter((approval) => approval.status === "pending"))
        : [],
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
  const agentMember = isAgent
    ? (memberById.get(conversation.id) ??
       members.find((m) => m.kind === "agent" && (m.id === conversation.id || m.name === conversation.id)))
    : undefined;
  const tabs = isAgent ? AGENT_TABS : CHANNEL_TABS;
  const tabIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs]);
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

  const { scrollToLatest, handleScroll, newMessageCount } = useChatScrollToBottom({
    listRef,
    bottomRef,
    feed,
    latestMessageSignal,
    pendingApprovalIds,
    conversationKey: `${conversation.id}:${conversation.type}`,
    virtualizerTotalSize: messageVirtualizer.getTotalSize(),
  });

  const liveThreadRuns = useMemo(() => {
    if (!currentThreadId) return EMPTY_RUNS;
    const byId = new Map<string, RunState>();
    for (const run of [...feed.runs, ...globalActiveRuns]) {
      if (!run.threadId || run.threadId !== currentThreadId || !isLiveRun(run)) continue;
      byId.set(run.id, run);
    }
    return [...byId.values()];
  }, [currentThreadId, feed.runs, globalActiveRuns]);
  const liveTraceSteps = useMemo(() => {
    if (!currentThreadId || liveThreadRuns.length === 0) return [];
    return buildReasoningTraceSteps({
      threadId: currentThreadId,
      agentIdFilter: conversation.type === "agent" ? conversation.id : undefined,
      conversationName: conversation.name,
      conversationType: conversation.type,
      members: traceMembers,
      activity: feed.activity,
      runs: liveThreadRuns,
      organizationId: bootstrap.organization?.id,
    });
  }, [
    bootstrap.organization?.id,
    conversation.id,
    conversation.name,
    conversation.type,
    currentThreadId,
    feed.activity,
    liveThreadRuns,
    traceMembers,
  ]);
  const liveChangeSummary = useMemo(() => summarizeFileChanges(liveTraceSteps), [liveTraceSteps]);
  const waitingInputRunIds = useMemo(
    () => liveThreadRuns.filter((run) => run.status === "waiting_for_input").map((run) => run.id),
    [liveThreadRuns],
  );
  const questionRefreshSignal = useMemo(
    () => feed.runs.map((run) => `${run.id}:${run.status}:${run.endedAt ?? ""}:${run.summary}`).join("|"),
    [feed.runs],
  );
  const typingRuns = activeTab === "conversation" ? liveThreadRuns : EMPTY_RUNS;
  const activeStep = useMemo(() => {
    const running = typingRuns.find((r) => r.status === "running");
    const s = running?.step;
    if (!s || s.toLowerCase() === "running") return undefined;
    return s;
  }, [typingRuns]);
  const typingStartedAt = useMemo(
    () => typingRuns.map((run) => run.startedAt).filter(Boolean).sort()[0],
    [typingRuns],
  );
  const runTokenUsage = useWorkspaceStore((state) => state.runTokenUsage);
  const typingTokenUsage = useMemo(() => {
    const entries = typingRuns
      .map((run) => runTokenUsage[run.id])
      .filter((usage): usage is { inputTokens: number; outputTokens: number } => !!usage);
    if (entries.length === 0) return undefined;
    return entries.reduce(
      (acc, usage) => ({
        inputTokens: acc.inputTokens + usage.inputTokens,
        outputTokens: acc.outputTokens + usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    );
  }, [runTokenUsage, typingRuns]);
  const traceStartedAt = useMemo(
    () => liveThreadRuns.map((run) => run.startedAt).filter(Boolean).sort()[0],
    [liveThreadRuns],
  );
  const traceAutoScroll = reasoningTraceVisible && liveThreadRuns.length > 0;
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
    if (typingRuns[0].status === "waiting_for_input") {
      return `${memberName} is waiting for your answer`;
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
  const { pendingQuestions, activeQuestionIndex, setActiveQuestionIndex, removeQuestion } =
    useThreadQuestions({
      currentThreadId,
      organizationId,
      waitingInputRunIds,
      refreshSignal: questionRefreshSignal,
    });
  const mentionSuggestions = useMemo(() => (
    members
      .filter((member) => member.id !== bootstrap.auth.member?.id)
      .sort((a, b) => {
        if (a.kind === b.kind) return a.name.localeCompare(b.name);
        return a.kind === "agent" ? -1 : 1;
      })
      .map((member) => ({
        id: member.id,
        name: member.name,
        detail: member.roleName,
      }))
  ), [bootstrap.auth.member?.id, members]);

  const stopAgentRun = useCallback(
    async (runId: string) => {
      if (!organizationId) {
        throw new Error("Missing organization context.");
      }
      const body = await clientFetchJson<unknown>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      }, "Unable to stop the run.");
      const parsed = RunStateSchema.safeParse(body);
      if (parsed.success) {
        upsertRun(parsed.data, runToActivity);
      }
    },
    [organizationId, upsertRun],
  );
  const stopRuns = useCallback(async () => {
    const runIds = [...stoppableRunIds];
    if (runIds.length === 0) return;
    setStoppingRunId(runIds[0]);
    setStopError(undefined);
    try {
      const results = await Promise.allSettled(runIds.map((runId) => stopAgentRun(runId)));
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) {
        setStopError(failure.reason instanceof Error ? failure.reason.message : "Unable to stop the run.");
      }
    } finally {
      setStoppingRunId(undefined);
    }
  }, [stopAgentRun, stoppableRunIds]);
  const answerQuestion = useCallback(
    async (questionId: string, selectedOption: string) => {
      setResolvingQuestions((state) => ({ ...state, [questionId]: true }));
      setQuestionErrors((state) => {
        const next = { ...state };
        delete next[questionId];
        return next;
      });
      try {
        await clientFetchJson<unknown>(`/api/questions/${encodeURIComponent(questionId)}/answer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ selectedOption }),
        }, "Unable to answer question.");
        removeQuestion(questionId);
      } catch (error) {
        setQuestionErrors((state) => ({
          ...state,
          [questionId]: error instanceof Error ? error.message : "Unable to answer question.",
        }));
      } finally {
      setResolvingQuestions((state) => {
        const next = { ...state };
        delete next[questionId];
        return next;
      });
      }
    },
    [removeQuestion],
  );
  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab as typeof activeTab);
    },
    [setActiveTab],
  );
  const openAgentChat = useCallback((threadId: string, name: string) => {
    handleTabChange("conversation");
    onSelectConversation?.({
      type: "channel",
      id: threadId,
      name,
    });
  }, [handleTabChange, onSelectConversation]);

  const handleOpenTasksTab = useCallback(() => {
    handleTabChange("tasks");
  }, [handleTabChange]);

  const handleNavigateChannel = useCallback(
    (channelId: string, fallbackName?: string) => {
      const channel = channelById.get(channelId);
      if (channel) {
        onSelectConversation?.({ type: "channel", id: channel.id, name: channel.name });
        return;
      }
      // Not a known channel — e.g. a channel-scoped delegation thread.
      // Open it directly by thread id (the server allows the owner to read
      // agent-only threads).
      onSelectConversation?.({ type: "channel", id: channelId, name: fallbackName ?? "Delegation" });
    },
    [channelById, onSelectConversation],
  );

  const feedRef = useRef(feed);
  feedRef.current = feed;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;

  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  const handleComposerCommand = useCallback(
    async (command: string) => {
      await feedRef.current.archiveConversation(command as "summarize" | "clear");
      setReplyTo(null);
      scrollToLatest("auto");
    },
    [scrollToLatest],
  );

  const handleSend = useCallback(
    (content: string, attachmentIds?: string[], metadata?: ConversationMessageMetadata) => {
      if (isAgent) {
        openDetailsForAgentMessage();
      }
      const promise = feedRef.current.sendMessage(content, replyToRef.current?.id, attachmentIds, metadata);
      setReplyTo(null);
      return promise;
    },
    [isAgent, openDetailsForAgentMessage],
  );

  const handleReasoningEffortChange = useCallback(
    (effort: ReasoningEffort) => {
      if (currentThreadId) setComposerReasoningEffort(currentThreadId, effort);
    },
    [currentThreadId, setComposerReasoningEffort],
  );
  const openChangesTab = useCallback(() => {
    setDetailsTab("Changes");
    setShowDetails(true, { userIntent: true });
  }, [setDetailsTab, setShowDetails]);

  const semanticActivityCount = useMemo(
    () => countSemanticActivityEvents(feed.activity),
    [feed.activity],
  );
  const attachmentCount = useMemo(
    () => countMessageAttachments(feed.messages),
    [feed.messages],
  );

  const resolvedChannelMemberCount = useMemo(() => {
    const activeMemberIds = new Set(members.map((member) => member.id));
    return channelMemberIds.filter((memberId) => activeMemberIds.has(memberId)).length;
  }, [channelMemberIds, members]);

  const tabCounts = useMemo(
    () =>
      buildTabCounts({
        activityCount: semanticActivityCount,
        approvals: feed.approvals,
        attachmentCount,
        runs: feed.runs,
      }),
    [attachmentCount, feed.approvals, feed.runs, semanticActivityCount],
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
                  ? resolvedChannelMemberCount
                  : tab.id === "tasks"
                    ? tabCounts.tasks
                    : undefined,
        countVariant:
          tab.id === "approvals" && tabCounts.approvals > 0 ? ("warning" as const) : ("default" as const),
      })),
    [
      resolvedChannelMemberCount,
      tabCounts.activity,
      tabCounts.approvals,
      tabCounts.files,
      tabCounts.tasks,
      tabs,
    ],
  );
  const conversationAttachmentsSource = activeTab === "files" ? feed.messages : null;
  const conversationAttachments = useMemo(
    () => (conversationAttachmentsSource ? collectConversationAttachments(conversationAttachmentsSource) : []),
    [conversationAttachmentsSource],
  );

  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_PAGE_SIZE);

  const visibleActivity = useMemo(() => {
    if (activeTab !== "activity") return EMPTY_ACTIVITY_EVENTS;
    const base = feed.activity.filter(isSidebarActivityEvent);
    const filtered =
      activityFilter === "all"
        ? base
        : base.filter((event) => ACTIVITY_FILTER_MATCHERS[activityFilter](event.type));
    return filtered.slice(-MAX_ACTIVITY_ROWS).reverse();
  }, [activeTab, feed.activity, activityFilter]);

  const activityPage = useMemo(
    () => visibleActivity.slice(0, activityLimit),
    [visibleActivity, activityLimit],
  );

  const activityDayGroups = useMemo(() => {
    const groups: { label: string; events: typeof activityPage }[] = [];
    for (const event of activityPage) {
      const label = calendarDayLabel(event.timestamp);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.events.push(event);
      else groups.push({ label, events: [event] });
    }
    return groups;
  }, [activityPage]);

  useLayoutEffect(() => {
    if (!tabIds.has(activeTab)) {
      setActiveTab("conversation");
    }
  }, [activeTab, setActiveTab, tabIds]);

  const detailsCol = showDetails ? `${Math.max(detailsWidth, 33)}%` : "0px";
  const activeQuestion = pendingQuestions[activeQuestionIndex];
  const hasBlockingPrompts = pendingThreadApprovals.length > 0 || Boolean(activeQuestion);
  const showNewMessages = activeTab === "conversation" && newMessageCount > 0;
  const newMessagesLabel = newMessageCount === 1 ? "1 new message" : `${newMessageCount} new messages`;

  return (
    <div
      data-chat-font-size={chatFontSize}
      className={`grid flex-1 min-h-0 overflow-hidden bg-white dark:bg-[#09090b] ${WORKSPACE_MAIN_GRID_TRANSITION}`}
      style={{ gridTemplateColumns: `minmax(0, 1fr) minmax(0, ${detailsCol})` }}
    >
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <ChatTabs
          tabs={tabsWithCounts}
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />
        {activeTab === "conversation" ? (
          <div className="relative flex flex-1 min-h-0 flex-col" aria-busy={Boolean(feed.archiving)}>
            {feed.archiving ? (
              <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex justify-center">
                <div
                  role="status"
                  aria-live="polite"
                  className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-violet-200 bg-white/95 px-3 py-2.5 text-sm shadow-lg shadow-violet-500/10 backdrop-blur dark:border-violet-500/30 dark:bg-zinc-900/95"
                >
                  <Loader2
                    className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 motion-safe:animate-spin dark:text-violet-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-800 dark:text-zinc-100">
                      {feed.archiving === "clear" ? "Clearing conversation" : "Summarizing conversation"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      Working through the transcript. You can keep reading while it runs.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
            <ChatMessageList ref={listRef} onScroll={handleScroll} className="pt-3">
            {feed.loading && feed.messages.length === 0 ? (
              <ListSkeleton variant="conversation" />
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
                          className="absolute left-0 top-0 w-full pb-1"
                          style={{
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <ChatMessage
                            message={message}
                            organizationId={organizationId}
                            members={members}
                            onOpenTasksTab={handleOpenTasksTab}
                            onNavigateChannel={handleNavigateChannel}
                            onOpenWorkflowRun={openWorkflowRunDrawer}
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
                      startedAt={typingStartedAt}
                      tokenUsage={typingTokenUsage}
                      changeSummary={liveChangeSummary}
                      onOpenChanges={openChangesTab}
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
              key={currentThreadId ?? conversation.id}
              organizationId={organizationId}
              channel={{ ...currentChannel, memberIds: channelMemberIds }}
              members={members}
              onSaved={setChannelMemberIds}
            />
          ) : feed.loading ? (
            <TabPanel><ListSkeleton variant="member" /></TabPanel>
          ) : (
            <TabEmpty context="members" label="Channel unavailable." />
          )
        ) : activeTab === "approvals" ? (
          feed.loading ? (
            <TabPanel><ListSkeleton variant="card" /></TabPanel>
          ) : visibleApprovals.length > 0 ? (
            <TabPanel>
              <ApprovalQueue
                approvals={visibleApprovals}
                resolving={resolvingApprovals}
                errors={approvalErrors}
                onResolve={resolveApproval}
              />
            </TabPanel>
          ) : (
            <TabEmpty context="approvals" label="No approvals." />
          )
        ) : activeTab === "tasks" ? (
          organizationId ? (
            <TabPanel>
              <ChannelGoalsBoard
                key={currentThreadId ?? conversation.id}
                channelId={currentThreadId ?? conversation.id}
                members={members}
              />
            </TabPanel>
          ) : (
            <TabEmpty context="tasks" label="No organization context available." />
          )
        ) : activeTab === "workflows" ? (
          organizationId ? (
            <TabPanel>
              <ChannelWorkflowsTab
                channelId={conversation.id}
                threadId={currentThreadId ?? conversation.id}
              />
            </TabPanel>
          ) : (
            <TabEmpty context="generic" label="No organization context available." />
          )
        ) : activeTab === "culture" ? (
          (conversation.type === "channel" || conversation.type === "agent") && organizationId ? (
            <TabPanel>
              <CultureTab organizationId={organizationId} channelId={conversation.id} members={traceMembers} />
            </TabPanel>
          ) : (
            <TabEmpty context="generic" label="Culture is only available in channels and DMs." />
          )
        ) : activeTab === "files" ? (
          feed.loading ? (
            <TabPanel><ListSkeleton variant="file" /></TabPanel>
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
            <TabPanel><ListSkeleton variant="activity" /></TabPanel>
          ) : visibleActivity.length > 0 ? (
            <TabPanel>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1" role="group" aria-label="Filter activity">
                    {(["all", "runs", "tools", "approvals"] as const).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        aria-pressed={activityFilter === filter}
                        onClick={() => {
                          setActivityFilter(filter);
                          setActivityLimit(ACTIVITY_PAGE_SIZE);
                        }}
                        className={`rounded-md border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                          activityFilter === filter
                            ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300"
                            : "border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:border-zinc-700"
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    Showing {activityPage.length} of {visibleActivity.length}
                  </span>
                </div>
                {activityDayGroups.map((group) => (
                  <div key={group.label} className="space-y-2">
                    <p className="sticky top-0 z-[1] bg-background px-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      {group.label}
                    </p>
                    {group.events.map((event) => (
                      <ActivityRow
                        key={event.event_id}
                        event={event}
                        onOpenTask={() => handleOpenTasksTab()}
                      />
                    ))}
                  </div>
                ))}
                {activityPage.length < visibleActivity.length ? (
                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={() => setActivityLimit((limit) => limit + ACTIVITY_PAGE_SIZE)}
                      className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Show more ({visibleActivity.length - activityPage.length} earlier)
                    </button>
                  </div>
                ) : null}
              </div>
            </TabPanel>
          ) : (
            <TabEmpty context="activity" label="No activity." />
          )
        )}
        <FloatingStatusRail
          channels={bootstrap.channels}
          members={members}
          currentThreadId={currentThreadId}
          activeTerminals={activeTerminals}
          onOpenChat={openAgentChat}
          onOpenTerminal={() => setIsTerminalDrawerOpen(true)}
        />
        {showNewMessages ? (
          <div className="shrink-0 px-3 pb-2">
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => scrollToLatest("smooth")}
                className="inline-flex items-center rounded-full border border-zinc-200/50 bg-white/30 px-3 py-1 text-[11px] font-semibold text-violet-600 shadow-sm backdrop-blur-sm transition hover:bg-white/50 dark:border-zinc-800/50 dark:bg-[#09090b]/30 dark:text-violet-400"
              >
                ({newMessagesLabel})
              </button>
            </div>
          </div>
        ) : null}
        {hasBlockingPrompts ? (
          <div className="shrink-0 px-3 pt-1.5 pb-2">
            <div className="space-y-2">
              {stoppableRunIds.length > 0 ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void stopRuns()}
                    disabled={!!stoppingRunId}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md bg-red-600 px-2.5 text-[11px] font-semibold text-white shadow-lg shadow-red-500/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    {stoppingRunId ? "Stopping" : stoppableRunIds.length > 1 ? "Stop runs" : "Stop run"}
                  </button>
                </div>
              ) : null}
              {stopError ? (
                <p className="text-[11px] text-red-500">{stopError}</p>
              ) : null}
              <ApprovalQueue
                approvals={pendingThreadApprovals}
                resolving={resolvingApprovals}
                errors={approvalErrors}
                onResolve={resolveApproval}
              />
              {activeQuestion ? (
                <QuestionCard
                  key={activeQuestion.id}
                  question={activeQuestion}
                  resolving={!!resolvingQuestions[activeQuestion.id]}
                  error={questionErrors[activeQuestion.id]}
                  activeQuestionIndex={activeQuestionIndex}
                  totalQuestions={pendingQuestions.length}
                  onIndexChange={setActiveQuestionIndex}
                  onAnswer={answerQuestion}
                />
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="shrink-0 px-3 pt-1.5 pb-3">
          <ChatInput
            organizationId={organizationId}
            goalMode={goalMode}
            onGoalModeChange={onGoalModeChange}
            scheduleMode={scheduleMode}
            onScheduleModeChange={setScheduleMode}
            readOnly={isReadOnly}
            reasoningProvider={reasoningModelSelection?.provider}
            reasoningModelValue={reasoningModelSelection?.model}
            reasoningEffort={composerReasoningEffort}
            onReasoningEffortChange={handleReasoningEffortChange}
            onCommand={handleComposerCommand}
            placeholder={
              isAgent
                ? `Message @${conversation.name} or type / for commands`
                : `Message #${conversation.name} or @agent · type / for commands`
            }
            inlineError={feed.error}
            mentionSuggestions={mentionSuggestions}
            replyTo={replyTo}
            draftKey={replyDraftKey}
            onCancelReply={handleCancelReply}
            stoppableRunIds={stoppableRunIds}
            onStopRuns={stopRuns}
            onSend={handleSend}
            actions={
              isAgent && agentMember && onMemberUpdated ? (
                <CollapsibleHeaderActions
                  key={`${conversation.type}:${conversation.id}`}
                  kind="agent"
                  chatFontSize={chatFontSize}
                  onChatFontSizeChange={setChatFontSize}
                  orgId={bootstrap.organization?.id ?? ""}
                  agentMember={agentMember}
                  providers={bootstrap.providers}
                  orgShellApprovalMode={orgShellApprovalMode}
                  goalMode={goalMode}
                  onMemberUpdated={onMemberUpdated}
                  onOpenAgentEditor={onOpenAgentEditor}
                />
              ) : conversation.type === "channel" && onOrgShellApprovalModeChange ? (
                <CollapsibleHeaderActions
                  key={`${conversation.type}:${conversation.id}`}
                  kind="channel"
                  chatFontSize={chatFontSize}
                  onChatFontSizeChange={setChatFontSize}
                  channelValue={orgShellApprovalMode}
                  onChannelChange={onOrgShellApprovalModeChange}
                />
              ) : (
                <CollapsibleHeaderActions
                  key={`${conversation.type}:${conversation.id}`}
                  kind="channel"
                  chatFontSize={chatFontSize}
                  onChatFontSizeChange={setChatFontSize}
                  channelValue={"never" as ShellApprovalMode}
                  onChannelChange={async () => undefined}
                />
              )
            }
          />
        </div>
      </div>

      <div
        className={`flex h-full min-h-0 min-w-0 overflow-hidden border-l border-zinc-200 dark:border-zinc-800 ${showDetails ? "" : "pointer-events-none"}`}
        aria-hidden={!showDetails}
      >
        <DragHandle side="right" onResize={setDetailsWidth} />
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <DetailsSidebar
            tabs={["Thinking trace", "Changes"]}
            activeTab={detailsTab}
            onTabChange={(tab) => setDetailsTab(tab as typeof detailsTab)}
            onClose={() => setShowDetails(false, { userIntent: true })}
          >
            {detailsTab === "Thinking trace" ? (
              <ReasoningTracePanel
                key={currentThreadId ?? conversation.id}
                organizationId={bootstrap.organization?.id}
                threadId={currentThreadId}
                conversationName={conversation.name}
                conversationType={conversation.type}
                members={traceMembers}
                liveSteps={reasoningTraceSteps}
                autoScroll={traceAutoScroll}
                startedAt={traceStartedAt}
              />
            ) : (
              <ChangesTab steps={reasoningTraceSteps} />
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
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pt-4">
      {children}
    </div>
  );
}

function TabEmpty({ context, label }: { context?: "messages" | "members" | "approvals" | "tasks" | "files" | "activity" | "search" | "generic"; label?: string }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pt-4">
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
