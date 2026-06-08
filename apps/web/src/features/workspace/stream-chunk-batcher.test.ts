import { describe, expect, it } from "vitest";
import { StreamChunkBatcher } from "./stream-chunk-batcher";

describe("StreamChunkBatcher", () => {
  it("merges text chunks for the same run and agent before flushing", () => {
    const flushed: { message?: { content?: string } }[] = [];
    const batcher = new StreamChunkBatcher((items) => {
      flushed.push(...items);
    });

    batcher.push({
      message: {
        id: "stream:run-1:ava",
        senderId: "ava",
        role: "assistant",
        name: "Ava",
        time: "12:00",
        content: "Hel",
        kind: "agent",
        createdAt: "2026-01-01T00:00:00.000Z",
        streamRunId: "run-1",
        pending: true,
      },
    });
    batcher.push({
      message: {
        id: "stream:run-1:ava",
        senderId: "ava",
        role: "assistant",
        name: "Ava",
        time: "12:01",
        content: "lo",
        kind: "agent",
        createdAt: "2026-01-01T00:00:01.000Z",
        streamRunId: "run-1",
        pending: true,
      },
    });

    batcher.flushNow();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.message?.content).toBe("Hello");
  });
});
