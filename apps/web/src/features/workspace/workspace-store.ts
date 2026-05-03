import { create } from "zustand";
import type { BootstrapResponse } from "@ujima/api-schema";
import type {
  ActivityEvent,
  ApprovalRequest,
  Message,
  RunState,
} from "@ujima/shared";
import type { SelectedConversation } from "./types";
import type { ChatMessageData, ApprovalCardData } from "./components/chat";
import type { ActivityState } from "./activity-state";
import { presenceToActivityState } from "./activity-state";

export type WorkspaceChannel = BootstrapResponse["channels"][number];
export type WorkspaceMember = BootstrapResponse["members"][number];
export type WorkspaceTab = "conversation" | "approvals" | "files" | "activity" | "tasks";
export type WorkspaceDetailsTab = "Reasoning trace" | "Changes" | "Metadata";

interface WorkspaceState {
  sidebarWidth: number;
  activeTab: WorkspaceTab;
  showDetails: boolean;
  detailsWidth: number;
  detailsTab: WorkspaceDetailsTab;
  selectedConversation?: SelectedConversation;
  channels: WorkspaceChannel[];
  members: WorkspaceMember[];
  memberActivity: Record<string, ActivityState>;
  messages: ChatMessageData[];
  approvals: ApprovalCardData[];
  runs: RunState[];
  activity: ActivityEvent[];
  loading: boolean;
  conversationKey?: string;
  setSidebarWidth(width: number): void;
  setActiveTab(tab: WorkspaceTab): void;
  setShowDetails(show: boolean): void;
  setDetailsWidth(width: number): void;
  setDetailsTab(tab: WorkspaceDetailsTab): void;
  syncWorkspace(input: {
    channels: WorkspaceChannel[];
    members: WorkspaceMember[];
    selectedConversation?: SelectedConversation;
  }): void;
  setSelectedConversation(conversation?: SelectedConversation): void;
  setChannels(channels: WorkspaceChannel[]): void;
  appendChannel(channel: WorkspaceChannel): void;
  setMembers(members: WorkspaceMember[]): void;
  appendMember(member: WorkspaceMember): void;
  setMemberActivity(memberId: string, activity: ActivityState): void;
  resetConversationFeed(conversationKey: string): void;
  setLoading(loading: boolean): void;
  hydrateMessages(messages: Message[], toMessage: (message: Message) => ChatMessageData, toActivity: (message: Message) => ActivityEvent): void;
  addPendingMessage(message: ChatMessageData): void;
  receiveMessage(tempId: string | undefined, message: Message, toMessage: (message: Message) => ChatMessageData, toActivity: (message: Message) => ActivityEvent): void;
  removeMessage(id: string): void;
  upsertApproval(approval: ApprovalRequest, toCard: (approval: ApprovalRequest, state: Pick<WorkspaceState, "members">) => ApprovalCardData, toActivity: (approval: ApprovalRequest) => ActivityEvent): void;
  upsertRun(run: RunState, toActivity: (run: RunState) => ActivityEvent): void;
  appendActivity(event: ActivityEvent): void;
}

const EMPTY_ACTIVITY = {
  sidebarWidth: 25,
  activeTab: "conversation" as WorkspaceTab,
  showDetails: false,
  detailsWidth: 25,
  detailsTab: "Reasoning trace" as WorkspaceDetailsTab,
  selectedConversation: undefined,
  channels: [],
  members: [],
  memberActivity: {},
  messages: [],
  approvals: [],
  runs: [],
  activity: [],
  loading: true,
  conversationKey: undefined,
};

function resolveDefaultConversation(
  channels: WorkspaceChannel[],
): SelectedConversation | undefined {
  const channel = channels.find((entry) => entry.name === "general") ?? channels[0];
  if (!channel) return undefined;
  return { type: "channel", id: channel.id, name: channel.name };
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
  return [...map.values()].sort(
    (a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""),
  );
}

function mergeApprovals(current: ApprovalCardData[], incoming: ApprovalCardData[]): ApprovalCardData[] {
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

function appendActivity(current: ActivityEvent[], incoming: ActivityEvent[]): ActivityEvent[] {
  const map = new Map<string, ActivityEvent>();
  for (const event of [...current, ...incoming]) map.set(event.event_id, event);
  return [...map.values()].slice(-200);
}

export function sameConversation(
  left?: SelectedConversation,
  right?: SelectedConversation,
): boolean {
  return !!left && !!right && left.type === right.type && left.id === right.id;
}

function sameItems<T extends { id: string }>(current: T[], incoming: T[]): boolean {
  return (
    current.length === incoming.length &&
    current.every((item, index) => item.id === incoming[index]?.id && sameRecord(item, incoming[index]))
  );
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ...EMPTY_ACTIVITY,
  setSidebarWidth: (sidebarWidth) =>
    set((state) => (state.sidebarWidth === sidebarWidth ? state : { sidebarWidth })),
  setActiveTab: (activeTab) =>
    set((state) => (state.activeTab === activeTab ? state : { activeTab })),
  setShowDetails: (showDetails) =>
    set((state) => (state.showDetails === showDetails ? state : { showDetails })),
  setDetailsWidth: (detailsWidth) =>
    set((state) => (state.detailsWidth === detailsWidth ? state : { detailsWidth })),
  setDetailsTab: (detailsTab) =>
    set((state) => (state.detailsTab === detailsTab ? state : { detailsTab })),
  syncWorkspace: ({ channels, members, selectedConversation }) =>
    set((state) => {
      const nextChannels = sameItems(state.channels, channels) ? state.channels : mergeChannels(state.channels, channels);
      const nextMembers = sameItems(state.members, members) ? state.members : mergeMembers(state.members, members);
      const currentSelection = state.selectedConversation;
      const selectionExists =
        currentSelection &&
        (currentSelection.type === "channel"
          ? nextChannels.some((channel) => channel.id === currentSelection.id)
          : nextMembers.some((member) => member.id === currentSelection.id));
      const nextSelection =
        (selectionExists ? currentSelection : selectedConversation) ??
        currentSelection ??
        resolveDefaultConversation(nextChannels);
      if (
        nextChannels === state.channels &&
        nextMembers === state.members &&
        sameConversation(currentSelection, nextSelection)
      ) {
        return state;
      }
      return {
        channels: nextChannels,
        members: nextMembers,
        selectedConversation: nextSelection,
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
  resetConversationFeed: (conversationKey) =>
    set((state) =>
      state.conversationKey === conversationKey && state.loading
        ? state
        : {
            messages: [],
            approvals: [],
            runs: [],
            activity: [],
            loading: true,
            conversationKey,
          },
    ),
  setLoading: (loading) =>
    set((state) => (state.loading === loading ? state : { loading })),
  hydrateMessages: (messages, toMessage, toActivity) =>
    set((state) => ({
      messages: mergeChatMessages(
        state.messages,
        messages.map((message) => toMessage(message)),
      ),
      activity: appendActivity(
        state.activity,
        messages.map((message) => toActivity(message)),
      ),
    })),
  addPendingMessage: (message) =>
    set((state) => ({ messages: mergeChatMessages(state.messages, [message]) })),
  receiveMessage: (tempId, message, toMessage, toActivity) =>
    set((state) => {
      const nextMessage = toMessage(message);
      const withoutTemp = tempId
        ? state.messages.filter((item) => item.id !== tempId)
        : state.messages.filter(
            (item) => !(item.pending && item.name === nextMessage.name && item.content === nextMessage.content),
          );
      if (withoutTemp.some((item) => item.id === nextMessage.id)) {
        return {
          messages: withoutTemp,
          activity: appendActivity(state.activity, [toActivity(message)]),
        };
      }
      return {
        messages: mergeChatMessages(withoutTemp, [nextMessage]),
        activity: appendActivity(state.activity, [toActivity(message)]),
      };
    }),
  removeMessage: (id) =>
    set((state) => ({ messages: state.messages.filter((message) => message.id !== id) })),
  upsertApproval: (approval, toCard, toActivity) =>
    set((state) => ({
      approvals: mergeApprovals(state.approvals, [toCard(approval, state)]),
      activity: appendActivity(state.activity, [toActivity(approval)]),
    })),
  upsertRun: (run, toActivity) =>
    set((state) => ({
      runs: mergeRuns(state.runs, [run]),
      activity: appendActivity(state.activity, [toActivity(run)]),
    })),
  appendActivity: (event) =>
    set((state) => ({ activity: appendActivity(state.activity, [event]) })),
}));

export function resolveMemberActivity(
  member: WorkspaceMember,
  memberActivity: Record<string, ActivityState>,
): ActivityState {
  return memberActivity[member.id] ?? presenceToActivityState(member.presence);
}
