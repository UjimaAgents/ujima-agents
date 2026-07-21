import { describe, expect, it } from "vitest";
import {
  getSystemMessageLabel,
  systemMessageBodyMarkdown,
} from "./chat-message";

describe("compaction summary rendering", () => {
  const summary = [
    "[[CONVERSATION_SUMMARY_V2]] # Compacted 6 earlier messages.",
    "",
    "> README-style compact summary -- your durable context from earlier in the conversation.",
    "> Treat these notes as your own continuity. Details that don't carry forward are safe to forget.",
    "",
    "## Work State",
    "- - Completed: fixed billing",
  ].join("\n");

  it("recognizes V2 summaries and hides internal header guidance", () => {
    expect(getSystemMessageLabel(summary)).toBe("Conversation compacted");
    expect(systemMessageBodyMarkdown(summary)).toBe(
      "## Work State\n- Completed: fixed billing",
    );
  });
});
