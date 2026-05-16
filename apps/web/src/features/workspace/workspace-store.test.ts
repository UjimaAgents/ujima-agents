import { describe, expect, it } from "vitest";
import {
  mergeConversationUnreadCounts,
  normalizeConversationSelection,
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
});
