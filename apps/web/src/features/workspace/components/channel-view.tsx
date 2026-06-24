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
  ChatHeader,
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
import { CultureTab } from "@/features/settings/shared/culture-tab";
import {
  getDirectMessageThreadId,
  parseConfiguredProviderModelValue,
  resolveMemberModelSelection,
  ApprovalRequestSchema,
  RunStateSchema,
  type ReasoningEffort,
  type RunState,
  type ActivityEvent,
} from "@ujima/shared/browser";
import {
  isAgentOnlyThread,
  selectActiveAgentChats,
  selectActiveTerminals,
  useWorkspaceStore,
  type ActiveJob,
} from "../workspace-store";
import { EmptyChat } from "./empty-chat";
import { TypingIndicator } from "./typing-indicator";
import { ActivityRow } from "./activity-row";
import { ChannelGoalsBoard } from "./channel-goals-board";
import { ConversationSkeleton } from "./conversation-skeleton";
import { ActivityListSkeleton } from "./activity-list-skeleton";
import { FileListSkeleton } from "./file-list-skeleton";
import { MemberListSkeleton } from "./member-list-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { resolveWorkspaceApproval } from "../approval-resolution";
import { approvalToActivity, runToActivity } from "../activity-events";
import { approvalToCard } from "../approval-card-data";
import { pendingApprovalVisibleInChannelView, queueApprovals } from "../approval-thread-filter";
import { summarizeFileChanges } from "../change-summary";
import { ReasoningTracePanel } from "./reasoning-trace-panel";
import { QuestionCard } from "./chat/question-card";
import {
  buildTabCounts,
  collectConversationAttachments,
  countMessageAttachments,
  countSemanticActivityEvents,
  isLiveRun,
} from "../feed-selectors";
import { buildReasoningTraceSteps } from "../reasoning-trace";
import type { Member, ShellApprovalMode, InteractiveQuestion } from "@ujima/shared/browser";

const CHANNEL_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "members", label: "Members" },
  { id: "approvals", label: "Approvals" },
  { id: "tasks", label: "Tasks" },
  { id: "culture", label: "Culture" },
  { id: "files", label: "Files" },
  { id: "activity", label: "Activity" },
];
const MAX_ACTIVITY_ROWS = 100;
const EMPTY_ACTIVITY_EVENTS = [] as ReturnType<typeof useConversationSync>["activity"];
const EMPTY_RUNS = [] as RunState[];

const AGENT_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "approvals", label: "Approvals" },
  { id: "tasks", label: "Tasks" },
  { id: "activity", label: "Activity" },
];

function useTerminalPolling(
  globalActiveRuns: RunState[],
  organizationId: string | undefined,
  setActiveTerminals: (jobs: ActiveJob[]) => void,
) {
  useEffect(() => {
    if (!organizationId || globalActiveRuns.length === 0) {
      setActiveTerminals([]);
      return;
    }

    let cancelled = false;
    let interval: NodeJS.Timeout | null = null;

    const pollJobs = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const jobsPromises = globalActiveRuns.map(async (run) => {
          const res = await fetch(
            `/api/runs/${encodeURIComponent(run.id)}/jobs?organizationId=${encodeURIComponent(organizationId)}`
          );
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void pollJobs();
        if (!interval) {
          interval = setInterval(pollJobs, 3000);
        }
      } else {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      }
    };

    if (document.visibilityState === "visible") {
      void pollJobs();
      interval = setInterval(pollJobs, 3000);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [globalActiveRuns, organizationId, setActiveTerminals]);
}

interface ReasoningTraceParams {
  currentThreadId?: string;
  reasoningTraceVisible: boolean;
  conversation: SelectedConversation;
  traceMembers: { id: string; name: string; kind: string }[];
  activity: ActivityEvent[];
  runs: RunState[];
  organizationId?: string;
}

function useReasoningTrace({
  currentThreadId,
  reasoningTraceVisible,
  conversation,
  traceMembers,
  activity,
  runs,
  organizationId,
}: ReasoningTraceParams) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [buildFn, setBuildFn] = useState<any>(null);

  useEffect(() => {
    if (reasoningTraceVisible && !buildFn) {
      import("../reasoning-trace").then((mod) => {
        setBuildFn(() => mod.buildReasoningTraceSteps);
      });
    }
  }, [reasoningTraceVisible, buildFn]);

  const liveTraceActivity = useMemo(
    () => (reasoningTraceVisible ? activity : []),
    [activity, reasoningTraceVisible],
  );
  const liveTraceRuns = useMemo(
    () => (reasoningTraceVisible ? runs : []),
    [runs, reasoningTraceVisible],
  );
  const deferredTraceActivity = useDeferredValue(liveTraceActivity);
  const deferredTraceRuns = useDeferredValue(liveTraceRuns);

  const reasoningTraceState = useMemo(
    () => (reasoningTraceVisible ? { activity: deferredTraceActivity, runs: deferredTraceRuns } : null),
    [deferredTraceActivity, deferredTraceRuns, reasoningTraceVisible],
  );

  const steps = useMemo(() => {
    if (!currentThreadId || !reasoningTraceVisible || !buildFn || !reasoningTraceState) {
      return [];
    }
    return buildFn({
      threadId: currentThreadId,
      agentIdFilter: conversation.type === "agent" ? conversation.id : undefined,
      conversationName: conversation.name,
      conversationType: conversation.type,
      members: traceMembers,
      activity: reasoningTraceState.activity,
      runs: reasoningTraceState.runs,
      organizationId,
    });
  }, [
    currentThreadId,
    reasoningTraceVisible,
    buildFn,
    conversation.id,
    conversation.name,
    conversation.type,
    traceMembers,
    reasoningTraceState,
    organizationId,
  ]);

  return steps;
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
  const [resolvingApprovals, setResolvingApprovals] = useState<Record<string, boolean>>({});
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});
  const [pendingQuestions, setPendingQuestions] = useState<InteractiveQuestion[]>([]);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [resolvingQuestions, setResolvingQuestions] = useState<Record<string, boolean>>({});
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});
  const [stoppingRunId, setStoppingRunId] = useState<string | undefined>();
  const [replyTo, setReplyTo] = useState<ChatMessageData | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const feed = useConversationSync(bootstrap, conversation);
  const activeTab = useWorkspaceStore((state) => state.activeTab);
  const showDetails = useWorkspaceStore((state) => state.showDetails);
  const detailsWidth = useWorkspaceStore((state) => state.detailsWidth);
  const detailsTab = useWorkspaceStore((state) => state.detailsTab);
  const chatFontSize = useWorkspaceStore((state) => state.chatFontSize);

  const {
    setActiveTab,
    setShowDetails,
    openDetailsForAgentMessage,
    setDetailsWidth,
    setDetailsTab,
    setChatFontSize,
    upsertApproval,
    upsertRun,
    setActiveTerminals,
  } = useWorkspaceStore(
    useShallow((state) => ({
      setActiveTab: state.setActiveTab,
      setShowDetails: state.setShowDetails,
      openDetailsForAgentMessage: state.openDetailsForAgentMessage,
      setDetailsWidth: state.setDetailsWidth,
      setDetailsTab: state.setDetailsTab,
      setChatFontSize: state.setChatFontSize,
      upsertApproval: state.upsertApproval,
      upsertRun: state.upsertRun,
      setActiveTerminals: state.setActiveTerminals,
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
  const globalApprovals = useWorkspaceStore((state) => state.approvals);
  const activeAgentChats = useMemo(
    () => selectActiveAgentChats({ channels: bootstrap.channels, members, globalActiveRuns, approvals: globalApprovals }, currentThreadId),
    [bootstrap.channels, currentThreadId, globalActiveRuns, globalApprovals, members],
  );
  const activeTerminals = useWorkspaceStore(selectActiveTerminals);
  const composerReasoningEffort =
    useWorkspaceStore((state) =>
      currentThreadId ? state.composerReasoningEffortByThread[currentThreadId] : undefined,
    ) ?? "none";
  const setComposerReasoningEffort = useWorkspaceStore((state) => state.setComposerReasoningEffort);
  const [isTerminalDrawerOpen, setIsTerminalDrawerOpen] = useState(false);
  const [stopError, setStopError] = useState<string | undefined>(undefined);

  useTerminalPolling(globalActiveRuns, bootstrap.organization?.id, setActiveTerminals);

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
  const reasoningTraceSteps = useReasoningTrace({
    currentThreadId,
    reasoningTraceVisible,
    conversation,
    traceMembers,
    activity: feed.activity,
    runs: feed.runs,
    organizationId: bootstrap.organization?.id,
  });

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

  const { scrollToLatest, handleScroll, newMessageCount } = useChatScrollToBottom({
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
  const organizationId = bootstrap.organization?.id;
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
  useEffect(() => {
    let cancelled = false;
    if (!organizationId || !currentThreadId) {
      setPendingQuestions([]);
      setActiveQuestionIndex(0);
      return;
    }
    void (async () => {
      const byThread = fetch(`/api/questions?threadId=${encodeURIComponent(currentThreadId)}`)
        .then(async (res) => {
          if (!res.ok) return [];
          const body = (await res.json().catch(() => null)) as { questions?: InteractiveQuestion[] } | null;
          return body?.questions ?? [];
        });
      const pages = await Promise.all(
        [
          byThread,
          ...waitingInputRunIds.map(async (runId) => {
            const res = await fetch(`/api/questions?runId=${encodeURIComponent(runId)}`);
            if (!res.ok) return [];
            const body = (await res.json().catch(() => null)) as { questions?: InteractiveQuestion[] } | null;
            return body?.questions ?? [];
          }),
        ],
      );
      if (cancelled) return;
      const next = Array.from(new Map(pages.flat().map((question) => [question.id, question])).values());
      setPendingQuestions(next);
      setActiveQuestionIndex((index) => Math.min(index, Math.max(next.length - 1, 0)));
    })();
    return () => {
      cancelled = true;
    };
  }, [currentThreadId, organizationId, questionRefreshSignal, waitingInputRunIds]);

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
          return;
        }
        const body = await response.json().catch(() => null);
        const parsed = ApprovalRequestSchema.safeParse(body);
        if (parsed.success) {
          upsertApproval(
            parsed.data,
            (value, state) => approvalToCard(value, { members: state.members }),
            approvalToActivity,
          );
        }
      } finally {
        setResolvingApprovals((state) => {
          const next = { ...state };
          delete next[approvalId];
          return next;
        });
      }
    },
    [organizationId, upsertApproval],
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
        const response = await fetch(`/api/questions/${encodeURIComponent(questionId)}/answer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ selectedOption }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            body && typeof body === "object" && "message" in body && typeof body.message === "string"
              ? body.message
              : "Unable to answer question.";
          setQuestionErrors((state) => ({ ...state, [questionId]: message }));
          return;
        }
        setPendingQuestions((state) => {
          const next = state.filter((question) => question.id !== questionId);
          setActiveQuestionIndex((index) => Math.min(index, Math.max(next.length - 1, 0)));
          return next;
        });
      } finally {
        setResolvingQuestions((state) => {
          const next = { ...state };
          delete next[questionId];
          return next;
        });
      }
    },
    [],
  );
  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab as typeof activeTab);
    },
    [setActiveTab],
  );

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
    async (command: string, _rawContent?: string, metadata?: ConversationMessageMetadata) => {
      if (currentThreadId && metadata?.reasoningEffort) {
        setComposerReasoningEffort(currentThreadId, metadata.reasoningEffort);
      }
      await feedRef.current.archiveConversation(command as "summarize" | "clear");
      setReplyTo(null);
      scrollToLatest("auto");
    },
    [currentThreadId, scrollToLatest, setComposerReasoningEffort],
  );

  const handleSend = useCallback(
    (content: string, attachmentIds?: string[], metadata?: ConversationMessageMetadata) => {
      if (currentThreadId && metadata?.reasoningEffort) {
        setComposerReasoningEffort(currentThreadId, metadata.reasoningEffort);
      }
      if (isAgent) {
        openDetailsForAgentMessage();
      }
      const promise = feedRef.current.sendMessage(content, replyToRef.current?.id, attachmentIds, metadata);
      setReplyTo(null);
      return promise;
    },
    [currentThreadId, isAgent, openDetailsForAgentMessage, setComposerReasoningEffort],
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
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <ChatHeader
          title={conversation.name}
          type={conversation.type === "agent" ? "dm" : "channel"}
          avatarName={isAgent ? conversation.name : undefined}
          avatarColorIndex={conversationColorIndex}
          status={selectedStatus.variant}
          statusLabel={selectedStatus.label}
          actions={
            isAgent && agentMember && onMemberUpdated ? (
              <CollapsibleHeaderActions
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
                kind="channel"
                chatFontSize={chatFontSize}
                onChatFontSizeChange={setChatFontSize}
                channelValue={orgShellApprovalMode}
                onChannelChange={onOrgShellApprovalModeChange}
              />
            ) : (
              <CollapsibleHeaderActions
                kind="channel"
                chatFontSize={chatFontSize}
                onChatFontSizeChange={setChatFontSize}
                channelValue={"never" as ShellApprovalMode}
                onChannelChange={async () => {}}
              />
            )
          }
          showDetails={showDetails}
          onToggleDetails={() => setShowDetails(!showDetails, { userIntent: true })}
        />
        <ChatTabs
          tabs={tabsWithCounts}
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />
        {activeTab === "conversation" ? (
          <div className="relative flex flex-1 min-h-0 flex-col">
            {feed.archiving ? (
              <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-white/70 backdrop-blur-[1px] dark:bg-zinc-950/70">
                <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-600 dark:text-violet-400" />
                  {feed.archiving === "clear" ? "Clearing conversation…" : "Summarizing…"}
                </div>
              </div>
            ) : null}
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
                            members={members}
                            onOpenTasksTab={handleOpenTasksTab}
                            onNavigateChannel={handleNavigateChannel}
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
            <TabPanel><MemberListSkeleton /></TabPanel>
          ) : (
            <TabEmpty context="members" label="Channel unavailable." />
          )
        ) : activeTab === "approvals" ? (
          feed.loading ? (
            <TabPanel><MemberListSkeleton /></TabPanel>
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
            <ChannelGoalsBoard
              key={currentThreadId ?? conversation.id}
              channelId={currentThreadId ?? conversation.id}
              members={members}
            />
          ) : (
            <TabEmpty context="tasks" label="No organization context available." />
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
                  {chat.name} {chat.agents.length > 1 ? "are" : "is"} chatting
                </span>
                {chat.pendingApprovals > 0 ? (
                  <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                    {chat.pendingApprovals} approval{chat.pendingApprovals === 1 ? "" : "s"}
                  </span>
                ) : null}
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
        {showNewMessages ? (
          <div className="shrink-0 px-3 pb-2">
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => scrollToLatest("smooth")}
                className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-700 shadow-sm transition hover:bg-violet-100 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/15"
              >
                ({newMessagesLabel})
              </button>
            </div>
          </div>
        ) : null}
        {hasBlockingPrompts ? (
          <div className="shrink-0 px-3 pt-1.5 pb-3">
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
        ) : (
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
              onCancelReply={handleCancelReply}
              stoppableRunIds={stoppableRunIds}
              onStopRuns={stopRuns}
              onSend={handleSend}
            />
          </div>
        )}
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
