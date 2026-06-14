import { describe, expect, it } from "vitest";
import { mergeVoiceTranscript } from "./voice-input-support";

describe("mergeVoiceTranscript", () => {
  it("appends spoken text to an existing draft with a space", () => {
    expect(mergeVoiceTranscript("Hello", "world", "")).toBe("Hello world");
  });

  it("includes interim text after finalized speech", () => {
    expect(mergeVoiceTranscript("Hello", "team", " today")).toBe("Hello team today");
  });

  it("returns the draft unchanged when nothing was spoken", () => {
    expect(mergeVoiceTranscript("Draft line", "", "")).toBe("Draft line");
  });

  it("returns only spoken text when the draft is empty", () => {
    expect(mergeVoiceTranscript("", "voice", " note")).toBe("voice note");
  });
});
