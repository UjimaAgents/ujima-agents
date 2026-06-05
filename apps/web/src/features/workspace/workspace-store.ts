import { create } from "zustand";
import type { BootstrapResponse } from "@ujima/api-schema";
import type {
  ActivityEvent,
  ApprovalRequest,
  Message,
  RunState,
} from "@ujima/shared/browser";
import {
  isAgentOnlyThread as isSharedAgentOnlyThread,
  parseDmThreadId,
} from "@ujima/shared/browser";
import type { SelectedConversation } from "./types";
import { resolveDefaultConversation } from "./workspace-channels";
import { isLiveRun } from "./feed-selectors";
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
  | "members"
  | "culture";
export type WorkspaceDetailsTab = "Thinking trace" | "Changes" | "Metadata";

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
  runs: RunState[];
  globalActiveRuns: RunState[];
  runTokenUsage: Record<string, { inputTokens: number; outputTokens: number }>;
  activeTerminals: ActiveJob[];
  activitySequence: number;
  activity: ActivityEvent[];
  loading: boolean;
  conversationKey?: string;
  setSidebarWidth(width: number): void;
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
  hydrateMessages(messages: Message[], toMessage: (message: Message) => ChatMessageData, toActivity: (message: Message) => ActivityEvent): void;
  addPendingMessage(message: ChatMessageData): void;
  receiveMessage(tempId: string | undefined, message: Message, toMessage: (message: Message) => ChatMessageData, toActivity: (message: Message) => ActivityEvent): void;
  appendRunChunk(message: ChatMessageData | undefined, activity: ActivityEvent): void;
  removeMessage(id: string): void;
  upsertApproval(approval: ApprovalRequest, toCard: (approval: ApprovalRequest, state: Pick<WorkspaceState, "members">) => ApprovalCardData, toActivity: (approval: ApprovalRequest) => ActivityEvent): void;
  upsertRun(run: RunState, toActivity: (run: RunState) => ActivityEvent): void;
  upsertGlobalActiveRun(run: RunState): void;
  setRunTokens(runId: string, inputTokens: number, outputTokens: number): void;
  setActiveTerminals(jobs: ActiveJob[]): void;
  appendActivity(event: ActivityEvent): void;
}

const DETAILS_AUTO_OPEN_DISMISSED_KEY = "ujima.workspace.detailsAutoOpenDismissed";

const EMPTY_ACTIVITY = {
  sidebarWidth: 18,
  activeTab: "conversation" as WorkspaceTab,
  showDetails: false,
  detailsAutoOpenDismissed: readDetailsAutoOpenDismissed(),
  detailsWidth: 33,
  detailsTab: "Thinking trace" as WorkspaceDetailsTab,
  selectedConversation: undefined,
  channels: [],
  members: [],
  memberActivity: {},
  conversationUnreadCounts: {},
  messages: [],
  approvals: [],
  runs: [],
  globalActiveRuns: [],
  runTokenUsage: {},
  activeTerminals: [],
  activitySequence: 0,
  activity: [],
  loading: true,
  conversationKey: undefined,
};

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  const map = new Map<string, ChatMessageData>();
  for (const message of [...current, ...incoming]) {
    map.set(message.id, message);
  }
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
  const stamped = events.map((event, index) => ({
    ...event,
    order: state.activitySequence + index,
  })).filter((event) => !seen.has(event.event_id));
  if (stamped.length === 0) return state;
  return {
    activitySequence: state.activitySequence + stamped.length,
    activity: [...state.activity, ...stamped],
  };
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
  state: Pick<WorkspaceState, "channels" | "members" | "globalActiveRuns">,
  currentThreadId?: string,
): ActiveAgentChat[] {
  const grouped = new Map<string, RunState[]>();
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
    const agents = agentThreadMembers(threadId, state).map((agent) => agent.name);
    return {
      threadId,
      name: agentOnlyThreadName(threadId, state) ?? agents.join(" & "),
      agents,
    };
  });
}

export function selectActiveTerminals(state: WorkspaceState): ActiveJob[] {
  return state.activeTerminals;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ...EMPTY_ACTIVITY,
  setSidebarWidth: (sidebarWidth) =>
    set((state) => (state.sidebarWidth === sidebarWidth ? state : { sidebarWidth })),
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
    set((state) =>
      state.conversationKey === conversationKey && state.loading
        ? state
        : {
            messages: [],
            approvals: [],
            runs: [],
            activitySequence: 0,
            activity: [],
            loading: true,
            conversationKey,
          },
    ),
  setLoading: (loading) =>
    set((state) => (state.loading === loading ? state : { loading })),
  hydrateMessages: (messages, toMessage, toActivity) =>
    set((state) => {
      const converted = messages.map((message) => toMessage(message));
      const lookup = new Map(state.messages.map((m) => [m.id, m]));
      for (const chat of converted) {
        lookup.set(chat.id, chat);
      }
      for (const chat of converted) {
        if (chat.parentMessageId && !chat.replyPreview) {
          const parent = lookup.get(chat.parentMessageId);
          if (parent) {
            chat.replyPreview = { name: parent.name, content: parent.content };
          }
        }
      }
      const mergedMessages = ensureReplyPreviews(mergeChatMessages(state.messages, converted));
      return {
        messages: mergedMessages,
        ...appendSequencedEvents(state, messages.map((message) => toActivity(message))),
      };
    }),
  addPendingMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  receiveMessage: (tempId, message, toMessage, toActivity) =>
    set((state) => {
      const nextMessage = toMessage(message);
      if (nextMessage.parentMessageId && !nextMessage.replyPreview) {
        const parent = state.messages.find((m) => m.id === nextMessage.parentMessageId);
        if (parent) {
          nextMessage.replyPreview = { name: parent.name, content: parent.content };
        }
      }
      const withoutTemp = tempId
        ? state.messages.filter((item) => item.id !== tempId)
        : state.messages.filter(
            (item) => !(item.pending && item.name === nextMessage.name && item.content === nextMessage.content),
          );
      if (withoutTemp.some((item) => item.id === nextMessage.id)) {
        return {
          messages: ensureReplyPreviews(mergeChatMessages(pruneStreamingMessage(withoutTemp, nextMessage), [nextMessage])),
          ...appendSequencedEvents(state, [toActivity(message)]),
        };
      }
      return {
        messages: ensureReplyPreviews(mergeChatMessages(pruneStreamingMessage(withoutTemp, nextMessage), [nextMessage])),
        ...appendSequencedEvents(state, [toActivity(message)]),
      };
    }),
  appendRunChunk: (message, activity) =>
    set((state) => {
      const run = message?.streamRunId ? state.runs.find((item) => item.id === message.streamRunId) : undefined;
      const liveMessage = run && !isLiveRun(run) ? undefined : message;
      const messages = mergeRunChunkMessages(state.messages, liveMessage ? [{ message: liveMessage }] : []);
      return {
        ...(messages === state.messages ? {} : { messages }),
        ...appendSequencedEvents(state, [activity]),
      };
    }),
  removeMessage: (id) =>
    set((state) => ({ messages: state.messages.filter((message) => message.id !== id) })),
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

export function resolveMemberActivity(
  member: WorkspaceMember,
  memberActivity: Record<string, ActivityState>,
): ActivityState {
  return memberActivity[member.id] ?? presenceToActivityState(member.presence);
}
