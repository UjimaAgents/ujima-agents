import { create } from "zustand";
import type { BootstrapResponse } from "@ujima/api-schema";
import type {
  ActivityEvent,
  ApprovalRequest,
  Message,
  ReasoningEffort,
  RunState,
} from "@ujima/shared/browser";
import {
  isAgentOnlyThread as isSharedAgentOnlyThread,
  parseDmThreadId,
} from "@ujima/shared/browser";
import type { SelectedConversation } from "./types";
import { resolveDefaultConversation } from "./workspace-channels";
import { isLiveRun } from "./feed-selectors";
import { liveActivityTextForRuns } from "./live-activity-text";
import { mergeRunChunkActivity, runChunkActivityKey } from "./run-chunk-activity";
import type { ChatMessageData, ApprovalCardData } from "./components/chat";
import type { ActivityState } from "./activity-state";
import { presenceToActivityState } from "./activity-state";

export type WorkspaceChannel = BootstrapResponse["channels"][number];
export type WorkspaceMember = BootstrapResponse["members"][number];
export type WorkspaceTab =
  | "conversation"
  | "approvals"
  | "files"
  | "activity"
  | "tasks"
  | "workflows"
  | "members"
  | "culture";
export type WorkspaceDetailsTab = "Thinking trace" | "Changes" | "Metadata";
export type ChatFontSize = "normal" | "large" | "xlarge" | "xxlarge" | "3xlarge" | "6xlarge";

export interface ActiveJob {
  runId: string;
  jobId: string;
  commandLine: string;
  cwd: string;
  status: string;
}

export interface ActiveAgentChat {
  threadId: string;
  name: string;
  agents: string[];
  pendingApprovals: number;
  activityText?: string;
}

export interface WorkspaceState {
  sidebarWidth: number;
  activeTab: WorkspaceTab;
  showDetails: boolean;
  detailsAutoOpenDismissed: boolean;
  detailsWidth: number;
  detailsTab: WorkspaceDetailsTab;
  selectedConversation?: SelectedConversation;
  channels: WorkspaceChannel[];
  members: WorkspaceMember[];
  memberActivity: Record<string, ActivityState>;
  conversationUnreadCounts: Record<string, number>;
  messages: ChatMessageData[];
  approvals: ApprovalCardData[];
  /** Workflow run whose drawer is open (shell-level slide-over), or null. */
  workflowRunDrawerId: string | null;
  runs: RunState[];
  globalActiveRuns: RunState[];
  runTokenUsage: Record<string, { inputTokens: number; outputTokens: number }>;
  composerReasoningEffortByThread: Record<string, ReasoningEffort>;
  activeTerminals: ActiveJob[];
  activitySequence: number;
  activity: ActivityEvent[];
  loading: boolean;
  conversationKey?: string;
  chatFontSize: ChatFontSize;
  hydrateClientPersisted(): void;
  setSidebarWidth(width: number): void;
  setChatFontSize(size: ChatFontSize): void;
  setActiveTab(tab: WorkspaceTab): void;
  setShowDetails(show: boolean, options?: { userIntent?: boolean }): void;
  openDetailsForAgentMessage(): void;
  setDetailsWidth(width: number): void;
  setDetailsTab(tab: WorkspaceDetailsTab): void;
  syncWorkspace(input: {
    channels: WorkspaceChannel[];
    members: WorkspaceMember[];
    conversationUnreadCounts?: Record<string, number>;
    selectedConversation?: SelectedConversation;
    globalActiveRuns?: RunState[];
  }): void;
  replaceConversationUnreadCounts(conversationUnreadCounts: Record<string, number>): void;
  setSelectedConversation(conversation?: SelectedConversation): void;
  setChannels(channels: WorkspaceChannel[]): void;
  appendChannel(channel: WorkspaceChannel): void;
  setMembers(members: WorkspaceMember[]): void;
  appendMember(member: WorkspaceMember): void;
  setMemberActivity(memberId: string, activity: ActivityState): void;
  incrementConversationUnreadCount(conversationId: string, by?: number): void;
  clearConversationUnreadCount(conversationId: string): void;
  resetConversationFeed(conversationKey: string): void;
  setLoading(loading: boolean): void;
  hydrateMessages(messages: Message[], toMessage: (message: Message) => ChatMessageData, toActivity: (message: Message) => ActivityEvent, expectedConversationKey?: string): void;
  addPendingMessage(message: ChatMessageData): void;
  receiveMessage(tempId: string | undefined, message: Message, toMessage: (message: Message) => ChatMessageData, toActivity: (message: Message) => ActivityEvent, expectedConversationKey?: string): void;
  appendRunChunk(message: ChatMessageData | undefined, activity?: ActivityEvent, expectedConversationKey?: string): void;
  appendRunChunkBatch(items: { message?: ChatMessageData; activity?: ActivityEvent }[], expectedConversationKey?: string): void;
  removeMessage(id: string): void;
  replaceApprovals(approvals: ApprovalCardData[]): void;
  /** Replace only workflow-gate approvals (sourced from the workflow-approvals poll). */
  setWorkflowApprovals(cards: ApprovalCardData[]): void;
  /** Remove a single approval by id (optimistic drop after resolving a workflow gate). */
  removeApproval(approvalId: string): void;
  /** Open/close the shell-level workflow run drawer (used by run cards + the running indicator). */
  openWorkflowRunDrawer(runId: string): void;
  closeWorkflowRunDrawer(): void;
  replaceRuns(runs: RunState[]): void;
  upsertApproval(approval: ApprovalRequest, toCard: (approval: ApprovalRequest, state: Pick<WorkspaceState, "members">) => ApprovalCardData, toActivity: (approval: ApprovalRequest) => ActivityEvent): void;
  upsertRun(run: RunState, toActivity: (run: RunState) => ActivityEvent): void;
  upsertGlobalActiveRun(run: RunState): void;
  setRunTokens(runId: string, inputTokens: number, outputTokens: number): void;
  setComposerReasoningEffort(threadId: string, effort: ReasoningEffort): void;
  setActiveTerminals(jobs: ActiveJob[]): void;
  appendActivity(event: ActivityEvent): void;
}

const DETAILS_AUTO_OPEN_DISMISSED_KEY = "ujima.workspace.detailsAutoOpenDismissed";
const CHAT_FONT_SIZE_KEY = "ujima.workspace.chatFontSize";
const COMPOSER_REASONING_EFFORT_KEY = "ujima.workspace.composerReasoningEffortByThread";
const CHAT_FONT_SIZE_DEFAULT: ChatFontSize = "normal";
const MAX_ACTIVITY_EVENTS = 1500;

// SSR-safe defaults. Persisted values from localStorage are applied post-mount
// via hydrateClientPersisted() to avoid a Next.js hydration mismatch.
const EMPTY_ACTIVITY = {
  sidebarWidth: 18,
  activeTab: "conversation" as WorkspaceTab,
  showDetails: false,
  detailsAutoOpenDismissed: false,
  detailsWidth: 40,
  detailsTab: "Thinking trace" as WorkspaceDetailsTab,
  selectedConversation: undefined,
  channels: [],
  members: [],
  memberActivity: {},
  conversationUnreadCounts: {},
  messages: [],
  approvals: [],
  workflowRunDrawerId: null,
  runs: [],
  globalActiveRuns: [],
  runTokenUsage: {},
  composerReasoningEffortByThread: {},
  activeTerminals: [],
  activitySequence: 0,
  activity: [],
  loading: true,
  conversationKey: undefined,
  chatFontSize: CHAT_FONT_SIZE_DEFAULT,
};

function shallowEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftObj = left as Record<string, unknown>;
  const rightObj = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObj);
  const rightKeys = Object.keys(rightObj);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (leftObj[key] !== rightObj[key]) return false;
  }
  return true;
}

/** @deprecated alias kept for call-sites – delegates to shallowEqual */
function sameRecord(left: unknown, right: unknown): boolean {
  return shallowEqual(left, right);
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k !== key) next[k] = v;
  }
  return next;
}

function mergeMembers(current: WorkspaceMember[], incoming: WorkspaceMember[]): WorkspaceMember[] {
  const map = new Map<string, WorkspaceMember>();
  for (const member of current) map.set(member.id, member);
  for (const member of incoming) map.set(member.id, member);
  return [...map.values()];
}

function mergeChannels(current: WorkspaceChannel[], incoming: WorkspaceChannel[]): WorkspaceChannel[] {
  const map = new Map<string, WorkspaceChannel>();
  for (const channel of current) map.set(channel.id, channel);
  for (const channel of incoming) map.set(channel.id, channel);
  return [...map.values()];
}

function mergeChatMessages(current: ChatMessageData[], incoming: ChatMessageData[]): ChatMessageData[] {
  // Fast path: if all incoming IDs are new and chronologically after the last
  // current message, we can just append without a full sort.
  const lastCurrentTime = current.length > 0 ? Date.parse(current[current.length - 1].createdAt ?? "") : -Infinity;
  const currentIds = current.length <= 200 ? new Set(current.map((m) => m.id)) : null;
  if (currentIds && incoming.length > 0) {
    let allNewAndOrdered = true;
    let prevTime = lastCurrentTime;
    for (const msg of incoming) {
      if (currentIds.has(msg.id)) { allNewAndOrdered = false; break; }
      const t = Date.parse(msg.createdAt ?? "");
      if (t < prevTime) { allNewAndOrdered = false; break; }
      prevTime = t;
    }
    if (allNewAndOrdered) return [...current, ...incoming];
  }

  const map = new Map<string, ChatMessageData>();
  for (const message of current) map.set(message.id, message);
  for (const message of incoming) map.set(message.id, message);
  return [...map.values()].sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""));
}

function ensureReplyPreviews(messages: ChatMessageData[]): ChatMessageData[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  let changed = false;
  const next = messages.map((message) => {
    if (message.replyPreview || !message.parentMessageId) return message;
    const parent = byId.get(message.parentMessageId);
    if (!parent) return message;
    changed = true;
    return {
      ...message,
      replyPreview: {
        name: parent.name,
        content: parent.content,
      },
    };
  });
  return changed ? next : messages;
}

function pruneStreamingMessage(current: ChatMessageData[], incoming: ChatMessageData): ChatMessageData[] {
  if (incoming.kind !== "agent" || incoming.pending || !incoming.streamRunId) return current;
  const rid = incoming.streamRunId;
  const streamPlaceholderId = `stream:${rid}:${incoming.senderId}`;
  return current.filter((message) => message.id !== streamPlaceholderId);
}

function mergeApprovals(current: ApprovalCardData[], incoming: ApprovalCardData[]): ApprovalCardData[] {
  const map = new Map<string, ApprovalCardData>();
  for (const item of current) map.set(item.id, item);
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function mergeRuns(current: RunState[], incoming: RunState[]): RunState[] {
  let next = current;
  for (const run of incoming) {
    const index = next.findIndex((item) => item.id === run.id);
    if (index === -1) {
      next = next === current ? [...current, run] : [...next, run];
      continue;
    }
    if (sameRecord(next[index], run)) continue;
    next = next === current ? [...current] : next;
    next[index] = run;
  }
  return next;
}

function appendSequencedEvents(
  state: Pick<WorkspaceState, "activitySequence" | "activity">,
  events: ActivityEvent[],
): Pick<WorkspaceState, "activitySequence" | "activity"> {
  if (events.length === 0) return state;
  const seen = new Set(state.activity.map((event) => event.event_id));
  const stamped: ActivityEvent[] = [];
  for (const event of events) {
    if (seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    stamped.push({ ...event, order: state.activitySequence + stamped.length });
  }
  if (stamped.length === 0) return state;
  let nextActivity = [...state.activity, ...stamped];
  if (nextActivity.length > MAX_ACTIVITY_EVENTS) {
    nextActivity = nextActivity.slice(-MAX_ACTIVITY_EVENTS);
  }
  return {
    activitySequence: state.activitySequence + stamped.length,
    activity: nextActivity,
  };
}

function upsertRunChunkActivity(
  state: Pick<WorkspaceState, "activitySequence" | "activity">,
  event: ActivityEvent,
): Pick<WorkspaceState, "activitySequence" | "activity"> {
  const key = runChunkActivityKey(event);
  if (!key) {
    return appendSequencedEvents(state, [event]);
  }

  const last = state.activity[state.activity.length - 1];
  if (last && runChunkActivityKey(last) === key) {
    return {
      activitySequence: state.activitySequence,
      activity: [...state.activity.slice(0, -1), mergeRunChunkActivity(last, event)],
    };
  }

  return appendSequencedEvents(state, [event]);
}

function applyRunChunkItems(
  state: WorkspaceState,
  items: { message?: ChatMessageData; activity?: ActivityEvent }[],
): Partial<WorkspaceState> {
  if (items.length === 0) return {};

  let messages = state.messages;
  let activitySequence = state.activitySequence;
  let activity = state.activity;

  for (const item of items) {
    const message = item.message;
    if (message) {
      const run = message.streamRunId ? state.runs.find((entry) => entry.id === message.streamRunId) : undefined;
      const liveMessage = run && !isLiveRun(run) ? undefined : message;
      if (liveMessage) {
        messages = mergeRunChunkMessages(messages, [{ message: liveMessage }]);
      }
    }
    if (item.activity) {
      const next = upsertRunChunkActivity({ activitySequence, activity }, item.activity);
      activitySequence = next.activitySequence;
      activity = next.activity;
    }
  }

  const patch: Partial<WorkspaceState> = {};
  if (messages !== state.messages) patch.messages = messages;
  if (activity !== state.activity || activitySequence !== state.activitySequence) {
    patch.activity = activity;
    patch.activitySequence = activitySequence;
  }
  return patch;
}

function mergeRunChunkMessages(
  current: ChatMessageData[],
  items: { message?: ChatMessageData }[],
): ChatMessageData[] {
  let messages = current;
  for (const item of items) {
    const message = item.message;
    if (!message) continue;
    const index = messages.findIndex((entry) => entry.id === message.id);
    if (index === -1) {
      messages = messages === current ? [...current, message] : [...messages, message];
      continue;
    }
    const existing = messages[index];
    const next = messages === current ? [...current] : messages;
    next[index] = {
      ...existing,
      content: `${existing.content}${message.content}`,
      createdAt: message.createdAt,
      time: message.time,
    };
    messages = next;
  }
  return messages;
}

export function sameConversation(
  left?: SelectedConversation,
  right?: SelectedConversation,
): boolean {
  return !!left && !!right && left.type === right.type && left.id === right.id;
}

export function normalizeConversationSelection(
  conversation: SelectedConversation | undefined,
  channels: WorkspaceChannel[],
  members: WorkspaceMember[],
): SelectedConversation | undefined {
  if (!conversation) return undefined;

  if (conversation.type === "channel") {
    const channel = channels.find((entry) => entry.id === conversation.id);
    if (!channel) {
      const name = agentOnlyThreadName(conversation.id, { channels, members });
      return name ? { ...conversation, name } : undefined;
    }
    if (channel.name === conversation.name) return conversation;
    return { ...conversation, name: channel.name };
  }

  const member = members.find((entry) => entry.id === conversation.id);
  if (!member) return undefined;
  if (member.name === conversation.name) return conversation;
  return { ...conversation, name: member.name };
}

export function mergeConversationUnreadCounts(
  current: Record<string, number>,
  incoming: Record<string, number> | undefined,
  channels: WorkspaceChannel[],
  members: WorkspaceMember[],
): Record<string, number> {
  const validIds = new Set([
    ...channels.map((channel) => channel.id),
    ...members.map((member) => member.id),
  ]);
  const next: Record<string, number> = {};

  for (const [conversationId, count] of Object.entries(current)) {
    if (validIds.has(conversationId)) {
      next[conversationId] = count;
    }
  }

  if (incoming) {
    for (const [conversationId, count] of Object.entries(incoming)) {
      if (!(conversationId in next) && validIds.has(conversationId)) {
        next[conversationId] = count;
      }
    }
  }

  return sameRecord(next, current) ? current : next;
}

function sameItems<T extends { id: string }>(current: T[], incoming: T[]): boolean {
  return (
    current.length === incoming.length &&
    current.every((item, index) => item.id === incoming[index]?.id && sameRecord(item, incoming[index]))
  );
}

function sameActiveJobs(current: ActiveJob[], incoming: ActiveJob[]): boolean {
  return current.length === incoming.length && current.every((job, index) => sameRecord(job, incoming[index]));
}

function findMember(id: string, members: WorkspaceMember[]): WorkspaceMember | undefined {
  return members.find((member) => member.id === id);
}

function agentThreadMembers(threadId: string, state: Pick<WorkspaceState, "channels" | "members">): WorkspaceMember[] {
  const dm = parseDmThreadId(threadId);
  if (dm) {
    const memberIds = [...new Set([dm.participantA, dm.participantB])];
    return memberIds
      .map((memberId) => findMember(memberId, state.members))
      .filter((member): member is WorkspaceMember => member?.kind === "agent");
  }

  const channel = state.channels.find((entry) => entry.id === threadId);
  if (!channel?.memberIds.length) return [];
  return channel.memberIds
    .map((memberId) => findMember(memberId, state.members))
    .filter((member): member is WorkspaceMember => member?.kind === "agent");
}

export function isAgentOnlyThread(
  threadId: string,
  state: Pick<WorkspaceState, "channels" | "members">,
): boolean {
  return isSharedAgentOnlyThread(
    threadId,
    state.members.map((member) => ({ id: member.id, kind: member.kind })),
    state.channels.map((channel) => ({ id: channel.id, memberIds: channel.memberIds })),
  );
}

export function agentOnlyThreadName(
  threadId: string,
  state: Pick<WorkspaceState, "channels" | "members">,
): string | undefined {
  const channel = state.channels.find((entry) => entry.id === threadId);
  if (channel) return channel.name;
  const dm = parseDmThreadId(threadId);
  if (dm && dm.participantA === dm.participantB) {
    const agent = findMember(dm.participantA, state.members);
    return agent?.kind === "agent" ? `${agent.name} (self delegation)` : undefined;
  }
  const agents = agentThreadMembers(threadId, state);
  return agents.length === 2 ? agents.map((agent) => agent.name).join(" & ") : undefined;
}

export function selectActiveAgentChats(
  state: Pick<WorkspaceState, "channels" | "members" | "globalActiveRuns" | "approvals" | "activity">,
  currentThreadId?: string,
): ActiveAgentChat[] {
  const grouped = new Map<string, RunState[]>();
  const approvalsByThread = new Map<string, number>();
  for (const approval of state.approvals) {
    if (approval.status !== "pending" || !approval.threadId) continue;
    approvalsByThread.set(approval.threadId, (approvalsByThread.get(approval.threadId) ?? 0) + 1);
  }
  for (const run of state.globalActiveRuns) {
    if (
      !run.threadId ||
      run.threadId === currentThreadId ||
      !isLiveRun(run) ||
      !isAgentOnlyThread(run.threadId, state)
    ) {
      continue;
    }
    grouped.set(run.threadId, [...(grouped.get(run.threadId) ?? []), run]);
  }

  return [...grouped.keys()].map((threadId) => {
    const runs = grouped.get(threadId) ?? [];
    const agents = agentThreadMembers(threadId, state).map((agent) => agent.name);
    const pendingApprovals = approvalsByThread.get(threadId) ?? 0;
    return {
      threadId,
      name: agentOnlyThreadName(threadId, state) ?? agents.join(" & "),
      agents,
      pendingApprovals,
      activityText: pendingApprovals > 0 ? "Approval required" : liveActivityTextForRuns(runs, state.activity),
    };
  });
}

export function selectActiveTerminals(state: WorkspaceState): ActiveJob[] {
  return state.activeTerminals;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ...EMPTY_ACTIVITY,
  hydrateClientPersisted: () =>
    set((state) => {
      const chatFontSize = readChatFontSize();
      const detailsAutoOpenDismissed = readDetailsAutoOpenDismissed();
      const composerReasoningEffortByThread = readComposerReasoningEfforts();
      if (
        state.chatFontSize === chatFontSize &&
        state.detailsAutoOpenDismissed === detailsAutoOpenDismissed &&
        shallowEqual(state.composerReasoningEffortByThread, composerReasoningEffortByThread)
      ) {
        return state;
      }
      return { chatFontSize, detailsAutoOpenDismissed, composerReasoningEffortByThread };
    }),
  setSidebarWidth: (sidebarWidth) =>
    set((state) => (state.sidebarWidth === sidebarWidth ? state : { sidebarWidth })),
  setChatFontSize: (chatFontSize) =>
    set((state) => {
      writeChatFontSize(chatFontSize);
      return state.chatFontSize === chatFontSize ? state : { chatFontSize };
    }),
  setActiveTab: (activeTab) =>
    set((state) => (state.activeTab === activeTab ? state : { activeTab })),
  setShowDetails: (showDetails, options) =>
    set((state) => {
      const userIntent = options?.userIntent === true;
      if (userIntent) {
        writeDetailsAutoOpenDismissed(!showDetails);
      }
      const detailsAutoOpenDismissed = userIntent ? !showDetails : state.detailsAutoOpenDismissed;
      if (
        state.showDetails === showDetails &&
        state.detailsAutoOpenDismissed === detailsAutoOpenDismissed
      ) {
        return state;
      }
      return { showDetails, detailsAutoOpenDismissed };
    }),
  openDetailsForAgentMessage: () =>
    set((state) =>
      state.showDetails || state.detailsAutoOpenDismissed
        ? state
        : { showDetails: true },
    ),
  setDetailsWidth: (detailsWidth) =>
    set((state) => (state.detailsWidth === detailsWidth ? state : { detailsWidth })),
  setDetailsTab: (detailsTab) =>
    set((state) => (state.detailsTab === detailsTab ? state : { detailsTab })),
  syncWorkspace: ({ channels, members, conversationUnreadCounts, selectedConversation, globalActiveRuns }) =>
    set((state) => {
      const nextChannels = sameItems(state.channels, channels) ? state.channels : channels;
      const nextMembers = sameItems(state.members, members) ? state.members : members;
      const nextUnreadCounts = mergeConversationUnreadCounts(
        state.conversationUnreadCounts,
        conversationUnreadCounts,
        nextChannels,
        nextMembers,
      );
      const currentSelection = normalizeConversationSelection(
        state.selectedConversation,
        nextChannels,
        nextMembers,
      );
      const passed = normalizeConversationSelection(
        selectedConversation,
        nextChannels,
        nextMembers,
      );
      const passedValid =
        passed &&
        conversationExists(passed, nextChannels, nextMembers);
      const selectionExists =
        currentSelection &&
        conversationExists(currentSelection, nextChannels, nextMembers);
      const nextSelection =
        (passedValid ? passed : undefined) ??
        (selectionExists ? currentSelection : undefined) ??
        resolveDefaultConversation(nextChannels);
      const selectionUnchanged =
        !state.selectedConversation && !nextSelection
          ? true
          : sameConversation(state.selectedConversation, nextSelection) &&
            state.selectedConversation?.name === nextSelection?.name;
      const nextGlobalRuns = globalActiveRuns
        ? (sameItems(state.globalActiveRuns, globalActiveRuns) ? state.globalActiveRuns : globalActiveRuns)
        : state.globalActiveRuns;

      if (
        nextChannels === state.channels &&
        nextMembers === state.members &&
        nextUnreadCounts === state.conversationUnreadCounts &&
        selectionUnchanged &&
        nextGlobalRuns === state.globalActiveRuns
      ) {
        return state;
      }
      return {
        channels: nextChannels,
        members: nextMembers,
        conversationUnreadCounts: nextUnreadCounts,
        selectedConversation: nextSelection,
        globalActiveRuns: nextGlobalRuns,
      };
    }),
  replaceConversationUnreadCounts: (conversationUnreadCounts) =>
    set((state) => (sameRecord(state.conversationUnreadCounts, conversationUnreadCounts) ? state : { conversationUnreadCounts })),
  setSelectedConversation: (selectedConversation) =>
    set((state) => {
      if (!state.selectedConversation && !selectedConversation) return state;
      if (sameConversation(state.selectedConversation, selectedConversation)) {
        // Metadata update (e.g. rename) for same thread/agent: keep active tab.
        if (state.selectedConversation?.name === selectedConversation?.name) {
          return state;
        }
        return { selectedConversation };
      }
      return { selectedConversation, activeTab: "conversation" };
    }),
  setChannels: (channels) =>
    set((state) => (sameItems(state.channels, channels) ? state : { channels })),
  appendChannel: (channel) =>
    set((state) => {
      const channels = mergeChannels(state.channels, [channel]);
      return sameItems(state.channels, channels) ? state : { channels };
    }),
  setMembers: (members) =>
    set((state) => (sameItems(state.members, members) ? state : { members })),
  appendMember: (member) =>
    set((state) => {
      const members = mergeMembers(state.members, [member]);
      return sameItems(state.members, members) ? state : { members };
    }),
  setMemberActivity: (memberId, activity) =>
    set((state) =>
      state.memberActivity[memberId] === activity
        ? state
        : { memberActivity: { ...state.memberActivity, [memberId]: activity } },
    ),
  incrementConversationUnreadCount: (conversationId, by = 1) =>
    set((state) => {
      const nextCount = (state.conversationUnreadCounts[conversationId] ?? 0) + by;
      return {
        conversationUnreadCounts: {
          ...state.conversationUnreadCounts,
          [conversationId]: nextCount,
        },
      };
    }),
  clearConversationUnreadCount: (conversationId) =>
    set((state) => {
      if (state.conversationUnreadCounts[conversationId] === 0) return state;
      return {
        conversationUnreadCounts: {
          ...state.conversationUnreadCounts,
          [conversationId]: 0,
        },
      };
    }),
  resetConversationFeed: (conversationKey) =>
    set((state) => {
      if (state.conversationKey === conversationKey && state.loading) return state;
      return {
        messages: [],
        approvals: [],
        runs: [],
        activitySequence: 0,
        activity: [],
        loading: true,
        conversationKey,
      };
    }),
  setLoading: (loading) =>
    set((state) => (state.loading === loading ? state : { loading })),
  hydrateMessages: (messages, toMessage, toActivity, expectedConversationKey) =>
    set((state) => {
      if (expectedConversationKey && state.conversationKey !== expectedConversationKey) return state;
      const converted = messages.map((message) => toMessage(message));
      const withoutStaleStreams = converted.reduce(pruneStreamingMessage, state.messages);
      const mergedMessages = ensureReplyPreviews(mergeChatMessages(withoutStaleStreams, converted));
      return {
        messages: mergedMessages,
        ...appendSequencedEvents(state, messages.map((message) => toActivity(message))),
      };
    }),
  addPendingMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  receiveMessage: (tempId, message, toMessage, toActivity, expectedConversationKey) =>
    set((state) => {
      if (expectedConversationKey && state.conversationKey !== expectedConversationKey) return state;
      const nextMessage = toMessage(message);
      if (nextMessage.parentMessageId && !nextMessage.replyPreview) {
        const parent = state.messages.find((m) => m.id === nextMessage.parentMessageId);
        if (parent) {
          nextMessage.replyPreview = { name: parent.name, content: parent.content };
        }
      }
      let withoutTemp = state.messages;
      if (tempId) {
        withoutTemp = state.messages.filter((item) => item.id !== tempId);
      } else {
        const pendingIndex = state.messages.findIndex((item) =>
          item.pending && (nextMessage.clientMessageId
            ? item.clientMessageId === nextMessage.clientMessageId
            : item.name === nextMessage.name && item.content === nextMessage.content),
        );
        if (pendingIndex >= 0) {
          withoutTemp = [...state.messages.slice(0, pendingIndex), ...state.messages.slice(pendingIndex + 1)];
        }
      }
      return {
        messages: ensureReplyPreviews(mergeChatMessages(pruneStreamingMessage(withoutTemp, nextMessage), [nextMessage])),
        ...appendSequencedEvents(state, [toActivity(message)]),
      };
    }),
  appendRunChunk: (message, activity, expectedConversationKey) =>
    set((state) => {
      if (expectedConversationKey && state.conversationKey !== expectedConversationKey) return state;
      const patch = applyRunChunkItems(state, [{ message, activity }]);
      return Object.keys(patch).length > 0 ? patch : state;
    }),
  appendRunChunkBatch: (items, expectedConversationKey) =>
    set((state) => {
      if (expectedConversationKey && state.conversationKey !== expectedConversationKey) return state;
      const patch = applyRunChunkItems(state, items);
      return Object.keys(patch).length > 0 ? patch : state;
    }),
  removeMessage: (id) =>
    set((state) => ({ messages: state.messages.filter((message) => message.id !== id) })),
  replaceApprovals: (approvals) =>
    set((state) => {
      // The MCP approval sync owns non-workflow rows; workflow gates live in the
      // same list (so every queue/pill consumer sees them) but are sourced
      // separately via setWorkflowApprovals — preserve them across MCP resyncs.
      const workflowRows = state.approvals.filter((a) => a.workflowRunId);
      const next = workflowRows.length ? [...approvals, ...workflowRows] : approvals;
      return sameItems(state.approvals, next) ? state : { approvals: next };
    }),
  setWorkflowApprovals: (cards) =>
    set((state) => {
      const next = [...state.approvals.filter((a) => !a.workflowRunId), ...cards];
      return sameItems(state.approvals, next) ? state : { approvals: next };
    }),
  removeApproval: (approvalId) =>
    set((state) => {
      const next = state.approvals.filter((a) => a.id !== approvalId);
      return next.length === state.approvals.length ? state : { approvals: next };
    }),
  openWorkflowRunDrawer: (runId) =>
    set((state) => (state.workflowRunDrawerId === runId ? state : { workflowRunDrawerId: runId })),
  closeWorkflowRunDrawer: () =>
    set((state) => (state.workflowRunDrawerId === null ? state : { workflowRunDrawerId: null })),
  replaceRuns: (runs) =>
    set((state) => (sameItems(state.runs, runs) ? state : { runs })),
  upsertApproval: (approval, toCard, toActivity) =>
    set((state) => ({
      approvals: mergeApprovals(state.approvals, [toCard(approval, state)]),
      ...appendSequencedEvents(state, [toActivity(approval)]),
    })),
  upsertRun: (run, toActivity) =>
    set((state) => {
      // Clear the live counter as soon as the run leaves live status;
      // the persisted footer on the final message takes over.
      const clearTokens = !isLiveRun(run) && run.id in state.runTokenUsage;
      return {
        runs: mergeRuns(state.runs, [run]),
        ...(clearTokens ? { runTokenUsage: omitKey(state.runTokenUsage, run.id) } : {}),
        ...appendSequencedEvents(state, [toActivity(run)]),
      };
    }),
  upsertGlobalActiveRun: (run) =>
    set((state) => {
      const isFinished = run.status === "completed" || run.status === "failed" || run.status === "cancelled";
      const nextGlobalRuns = isFinished
        ? state.globalActiveRuns.filter((r) => r.id !== run.id)
        : mergeRuns(state.globalActiveRuns, [run]);
      const clearTokens = isFinished && run.id in state.runTokenUsage;
      return {
        globalActiveRuns: nextGlobalRuns,
        ...(clearTokens ? { runTokenUsage: omitKey(state.runTokenUsage, run.id) } : {}),
      };
    }),
  setRunTokens: (runId, inputTokens, outputTokens) =>
    set((state) => {
      const existing = state.runTokenUsage[runId];
      if (existing && existing.inputTokens === inputTokens && existing.outputTokens === outputTokens) {
        return state;
      }
      return {
        runTokenUsage: { ...state.runTokenUsage, [runId]: { inputTokens, outputTokens } },
      };
    }),
  setComposerReasoningEffort: (threadId, effort) =>
    set((state) => {
      if (state.composerReasoningEffortByThread[threadId] === effort) return state;
      const next = { ...state.composerReasoningEffortByThread, [threadId]: effort };
      writeComposerReasoningEfforts(next);
      return { composerReasoningEffortByThread: next };
    }),
  setActiveTerminals: (activeTerminals) =>
    set((state) => (sameActiveJobs(state.activeTerminals, activeTerminals) ? state : { activeTerminals })),
  appendActivity: (event) => set((state) => appendSequencedEvents(state, [event])),
}));

function conversationExists(
  conversation: SelectedConversation,
  channels: WorkspaceChannel[],
  members: WorkspaceMember[],
): boolean {
  if (conversation.type === "agent") {
    return members.some((member) => member.id === conversation.id);
  }
  return (
    channels.some((channel) => channel.id === conversation.id) ||
    isAgentOnlyThread(conversation.id, { channels, members })
  );
}

function readDetailsAutoOpenDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DETAILS_AUTO_OPEN_DISMISSED_KEY) === "true";
}

function writeDetailsAutoOpenDismissed(dismissed: boolean): void {
  if (typeof window === "undefined") return;
  if (dismissed) {
    window.localStorage.setItem(DETAILS_AUTO_OPEN_DISMISSED_KEY, "true");
  } else {
    window.localStorage.removeItem(DETAILS_AUTO_OPEN_DISMISSED_KEY);
  }
}

function readChatFontSize(): ChatFontSize {
  if (typeof window === "undefined") return CHAT_FONT_SIZE_DEFAULT;
  const stored = window.localStorage.getItem(CHAT_FONT_SIZE_KEY);
  if (stored === "normal" || stored === "large" || stored === "xlarge" || stored === "xxlarge" || stored === "3xlarge" || stored === "6xlarge") return stored;
  return CHAT_FONT_SIZE_DEFAULT;
}

function writeChatFontSize(size: ChatFontSize): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHAT_FONT_SIZE_KEY, size);
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "none" || value === "low" || value === "medium" || value === "high" || value === "extra_high";
}

function readComposerReasoningEfforts(): Record<string, ReasoningEffort> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMPOSER_REASONING_EFFORT_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, ReasoningEffort] => isReasoningEffort(entry[1])),
    );
  } catch {
    return {};
  }
}

function writeComposerReasoningEfforts(values: Record<string, ReasoningEffort>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COMPOSER_REASONING_EFFORT_KEY, JSON.stringify(values));
}

export function resolveMemberActivity(
  member: WorkspaceMember,
  memberActivity: Record<string, ActivityState>,
): ActivityState {
  return memberActivity[member.id] ?? presenceToActivityState(member.presence);
}
