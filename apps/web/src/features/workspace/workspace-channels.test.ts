import { describe, expect, it } from "vitest";
import { resolveDefaultConversation, visibleWorkspaceChannels } from "./workspace-channels";
import type { WorkspaceChannel } from "./workspace-channels";

describe("workspace-channels", () => {
  const selfOnly: WorkspaceChannel[] = [
    { id: "self-1", name: "general", kind: "self", topic: "", memberIds: [] },
  ];

  it("excludes self and dm channels from the visible list", () => {
    const channels: WorkspaceChannel[] = [
      ...selfOnly,
      { id: "dm-1", name: "dm", kind: "dm", topic: "", memberIds: [] },
      { id: "ops", name: "ops", kind: "general", topic: "", memberIds: [] },
    ];
    expect(visibleWorkspaceChannels(channels).map((c) => c.id)).toEqual(["ops"]);
  });

  it("returns undefined default conversation when only hidden channels exist", () => {
    expect(resolveDefaultConversation(selfOnly)).toBeUndefined();
  });

  it("prefers a visible general channel", () => {
    const channels: WorkspaceChannel[] = [
      ...selfOnly,
      { id: "general-id", name: "general", kind: "general", topic: "", memberIds: [] },
    ];
    expect(resolveDefaultConversation(channels)).toEqual({
      type: "channel",
      id: "general-id",
      name: "general",
    });
  });
});
