import { describe, expect, it } from "vitest";
import { mergeVoiceTranscript } from "./voice-input-support";

describe("mergeVoiceTranscript", () => {
  it("appends spoken text to an existing draft with a space", () => {
    expect(mergeVoiceTranscript("Hello", "world", "")).toBe("Hello world");
  });

  it("includes interim text after finalized speech", () => {
    expect(mergeVoiceTranscript("Hello", "team", " today")).toBe("Hello team today");
  });

});
