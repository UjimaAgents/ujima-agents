import { describe, expect, it } from "vitest";
import {
  mergeConversationUnreadCounts,
  normalizeConversationSelection,
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

});
