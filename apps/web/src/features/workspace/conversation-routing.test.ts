import { describe, expect, it } from "vitest";
import type { BootstrapResponse } from "@ujima/api-schema";
import { resolveSelectedConversationFromSearchParams } from "./conversation-routing";

const bootstrap = {
  members: [
    { id: "agent-1", name: "Aiden", kind: "agent" },
    { id: "human-1", name: "Owner", kind: "human" },
  ],
  channels: [{ id: "chan-1", name: "general", kind: "channel" }],
} as unknown as BootstrapResponse;

function params(record: Record<string, string>): URLSearchParams {
  return new URLSearchParams(record);
}

describe("resolveSelectedConversationFromSearchParams", () => {
  it("resolves a known channel by id", () => {
    expect(resolveSelectedConversationFromSearchParams(params({ channelId: "chan-1" }), bootstrap))
      .toEqual({ type: "channel", id: "chan-1", name: "general" });
  });

  it("resolves an agent by id", () => {
    expect(resolveSelectedConversationFromSearchParams(params({ agentId: "agent-1" }), bootstrap))
      .toEqual({ type: "agent", id: "agent-1", name: "Aiden" });
  });

  it("round-trips a channel-scoped delegation thread (delegate:<uuid>)", () => {
    // The regression: a delegation deep-link / reload must reopen the
    // synthetic thread instead of falling back to the default conversation.
    const threadId = "delegate:11111111-2222-3333-4444-555555555555";
    expect(resolveSelectedConversationFromSearchParams(params({ channelId: threadId }), bootstrap))
      .toEqual({ type: "channel", id: threadId, name: "Delegation" });
  });

  it("returns undefined for an unknown, non-delegation channel id", () => {
    expect(
      resolveSelectedConversationFromSearchParams(params({ channelId: "nope-123" }), bootstrap),
    ).toBeUndefined();
  });
});
