import { describe, expect, it } from "vitest";
import { SocketEventNames } from "@ujima/shared";
import { shouldForwardEvent } from "./route";

const scope = {
  threadId: "delegate:one",
  channelIds: ["channel-general"],
  memberIds: [],
};

describe("conversation stream filtering", () => {
  it("forwards only channel messages from the requested thread", () => {
    expect(
      shouldForwardEvent(
        SocketEventNames.channelMessage,
        { channelId: "channel-general", message: { threadId: "delegate:one" } },
        scope,
      ),
    ).toBe(true);
    expect(
      shouldForwardEvent(
        SocketEventNames.channelMessage,
        { channelId: "channel-general", message: { threadId: "delegate:two" } },
        scope,
      ),
    ).toBe(false);
  });

  it("keeps channel presence scoped by channel", () => {
    expect(
      shouldForwardEvent(
        SocketEventNames.channelPresence,
        { channelId: "channel-general" },
        scope,
      ),
    ).toBe(true);
  });
});
