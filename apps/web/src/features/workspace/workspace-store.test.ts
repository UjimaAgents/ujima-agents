import { describe, expect, it } from "vitest";
import type { RunState } from "@ujima/shared/browser";
import {
  isAgentOnlyThread,
  mergeConversationUnreadCounts,
  normalizeConversationSelection,
  selectActiveAgentChats,
  useWorkspaceStore,
  type WorkspaceChannel,
  type WorkspaceMember,
} from "./workspace-store";

describe("workspace-store helpers", () => {
  const channels: WorkspaceChannel[] = [
    { id: "general", name: "ops", kind: "general", topic: "", memberIds: [] },
    { id: "random", name: "random", kind: "general", topic: "", memberIds: [] },
  ];
  const members: WorkspaceMember[] = [
    {
      id: "ava",
      organizationId: "org",
      name: "Ava",
      kind: "agent",
      roleName: "assistant",
      presence: "offline",
    },
    {
      id: "bo",
      organizationId: "org",
      name: "Bo",
      kind: "agent",
      roleName: "assistant",
      presence: "offline",
    },
    {
      id: "human",
      organizationId: "org",
      name: "Human",
      kind: "human",
      roleName: "operator",
      presence: "offline",
    },
  ];

  it("keeps the latest channel or member name in the selected conversation", () => {
    expect(
      normalizeConversationSelection(
        { type: "channel", id: "general", name: "general" },
        channels,
        members,
      ),
    ).toEqual({ type: "channel", id: "general", name: "ops" });

    expect(
      normalizeConversationSelection(
        { type: "channel", id: "missing", name: "general" },
        channels,
        members,
      ),
    ).toBeUndefined();

    expect(
      normalizeConversationSelection(
        { type: "agent", id: "ava", name: "old name" },
        channels,
        members,
      ),
    ).toEqual({ type: "agent", id: "ava", name: "Ava" });
  });

  it("preserves local read state while seeding new unread counts from bootstrap", () => {
    expect(
      mergeConversationUnreadCounts(
        { general: 0, ava: 3, stale: 7 },
        { general: 4, random: 2, ava: 1 },
        channels,
        members,
      ),
    ).toEqual({ general: 0, random: 2, ava: 3 });
  });

  it("replaces workspace lists on bootstrap sync", () => {
    useWorkspaceStore.setState({
      channels: [{ id: "old", name: "old", kind: "general", topic: "", memberIds: [] }],
      members: [
        {
          id: "old-agent",
          organizationId: "org",
          name: "Old",
          kind: "agent",
          roleName: "assistant",
          presence: "offline",
        },
      ],
      conversationUnreadCounts: {},
      selectedConversation: undefined,
    });

    useWorkspaceStore.getState().syncWorkspace({
      channels,
      members,
      selectedConversation: { type: "channel", id: "general", name: "ops" },
    });

    expect(useWorkspaceStore.getState().channels.map((channel) => channel.id)).toEqual([
      "general",
      "random",
    ]);
    expect(useWorkspaceStore.getState().members.map((member) => member.id)).toEqual(["ava", "bo", "human"]);
  });

  it("keeps enough live activity for long streaming traces", () => {
    const store = useWorkspaceStore.getState();
    store.resetConversationFeed("org:thread");

    for (let index = 0; index < 1_200; index += 1) {
      useWorkspaceStore.getState().appendActivity({
        event_id: `chunk-${index}`,
        type: "run_chunk",
        publisher: "ava",
        timestamp: new Date(0).toISOString(),
        payload: {
          runId: "run-1",
          threadId: "thread",
          agentId: "ava",
          kind: "reasoning",
          delta: ".",
        },
      });
    }

    const activity = useWorkspaceStore.getState().activity;
    expect(activity).toHaveLength(1_200);
    expect(activity[0]?.event_id).toBe("chunk-0");
  });

  it("detects agent-only channels and DMs", () => {
    const state = {
      channels: [
        { id: "agents", name: "agents", kind: "general" as const, topic: "", memberIds: ["ava", "bo"] },
        { id: "mixed", name: "mixed", kind: "general" as const, topic: "", memberIds: ["ava", "human"] },
      ],
      members,
    };

    expect(isAgentOnlyThread("agents", state)).toBe(true);
    expect(isAgentOnlyThread("dm:ava:bo", state)).toBe(true);
    expect(isAgentOnlyThread("mixed", state)).toBe(false);
    expect(isAgentOnlyThread("dm:ava:human", state)).toBe(false);
  });

  it("selects active agent chats outside the current thread", () => {
    useWorkspaceStore.setState({
      channels: [
        { id: "agents", name: "agents", kind: "general" as const, topic: "", memberIds: ["ava", "bo"] },
        { id: "mixed", name: "mixed", kind: "general" as const, topic: "", memberIds: ["ava", "human"] },
      ],
      members,
      globalActiveRuns: [
        run({ id: "run-1", agentId: "ava", threadId: "agents", status: "running" }),
        run({ id: "run-2", agentId: "bo", threadId: "agents", status: "waiting_for_approval" }),
        run({ id: "run-3", agentId: "ava", threadId: "dm:ava:bo", status: "running" }),
        run({ id: "run-4", agentId: "ava", threadId: "mixed", status: "running" }),
        run({ id: "run-5", agentId: "ava", threadId: "current", status: "running" }),
        run({ id: "run-6", agentId: "ava", threadId: "agents", status: "completed" }),
      ],
    });

    expect(selectActiveAgentChats(useWorkspaceStore.getState(), "current")).toEqual([
      { threadId: "agents", name: "agents", agents: ["Ava", "Bo"] },
      { threadId: "dm:ava:bo", name: "Ava & Bo", agents: ["Ava", "Bo"] },
    ]);
  });

});

function run(input: Pick<RunState, "id" | "agentId" | "threadId" | "status">): RunState {
  return {
    organizationId: "org",
    step: "",
    summary: "",
    startedAt: new Date(0).toISOString(),
    ...input,
  };
}
