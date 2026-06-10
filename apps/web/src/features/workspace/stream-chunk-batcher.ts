import type { ActivityEvent } from "@ujima/shared/browser";
import type { ChatMessageData } from "./components/chat";
import { mergeRunChunkActivity, runChunkActivityKey } from "./run-chunk-activity";

export interface RunChunkStoreItem {
  message?: ChatMessageData;
  activity?: ActivityEvent;
}

type ChunkMergeKey = string;

function chunkMergeKey(item: RunChunkStoreItem): ChunkMergeKey | null {
  if (item.activity) {
    const key = runChunkActivityKey(item.activity);
    if (key) return key;
  }
  if (item.message?.streamRunId && item.message.senderId) {
    return `text:${item.message.streamRunId}:${item.message.senderId}`;
  }
  return null;
}

function mergeRunChunkItems(existing: RunChunkStoreItem, incoming: RunChunkStoreItem): RunChunkStoreItem {
  const next: RunChunkStoreItem = { ...existing };

  if (incoming.message) {
    if (!next.message) {
      next.message = { ...incoming.message };
    } else {
      next.message = {
        ...next.message,
        content: `${next.message.content}${incoming.message.content}`,
        createdAt: incoming.message.createdAt,
        time: incoming.message.time,
      };
    }
  }

  if (incoming.activity) {
    if (!next.activity) {
      next.activity = incoming.activity;
    } else {
      next.activity = mergeRunChunkActivity(next.activity, incoming.activity);
    }
  }

  return next;
}

/**
 * Coalesces high-frequency run chunk updates and flushes them on animation frames
 * so the workspace store updates at most once per frame.
 */
export class StreamChunkBatcher {
  private pending = new Map<ChunkMergeKey, RunChunkStoreItem>();
  private rafId: number | null = null;

  constructor(private readonly flush: (items: RunChunkStoreItem[]) => void) {}

  push(item: RunChunkStoreItem): void {
    const key = chunkMergeKey(item);
    if (!key) {
      this.flush([item]);
      return;
    }

    const existing = this.pending.get(key);
    this.pending.set(key, existing ? mergeRunChunkItems(existing, item) : item);
    this.scheduleFlush();
  }

  flushNow(): void {
    this.cancelScheduledFlush();
    const items = [...this.pending.values()];
    this.pending.clear();
    if (items.length > 0) {
      this.flush(items);
    }
  }

  dispose(): void {
    this.flushNow();
  }

  private cancelScheduledFlush(): void {
    if (this.rafId === null) return;
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    } else {
      clearTimeout(this.rafId);
    }
    this.rafId = null;
  }

  private scheduleFlush(): void {
    if (this.rafId !== null) return;
    const flushPending = () => {
      this.rafId = null;
      const items = [...this.pending.values()];
      this.pending.clear();
      if (items.length > 0) {
        this.flush(items);
      }
    };
    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(flushPending);
      return;
    }
    this.rafId = globalThis.setTimeout(flushPending, 16) as unknown as number;
  }
}
