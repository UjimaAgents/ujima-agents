function pruneWindows(windows: Map<string, number[]>, cutoff: number): void {
  if (windows.size <= 1024) return;
  for (const [k, timestamps] of windows) {
    const kept = timestamps.filter((t) => t > cutoff);
    if (kept.length === 0) windows.delete(k);
    else windows.set(k, kept);
  }
}

function recordInWindow(
  windows: Map<string, number[]>,
  key: string,
  cap: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  pruneWindows(windows, cutoff);
  const recent = (windows.get(key) ?? []).filter((sample) => sample > cutoff);
  if (recent.length >= cap) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  return true;
}

export class MentionQuota {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly cap: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string): boolean {
    return recordInWindow(this.windows, key, this.cap, this.windowMs);
  }
}

export class ChannelReadQuota {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly cap: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string): boolean {
    return recordInWindow(this.windows, key, this.cap, this.windowMs);
  }
}

export class PairMentionTracker {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly cap: number,
    private readonly windowMs: number,
  ) {}

  record(key: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const existing = this.windows.get(key) ?? [];
    const kept = existing.filter((t) => t >= windowStart);
    kept.push(now);
    this.windows.set(key, kept);
    if (this.windows.size > 1024) {
      for (const [k, timestamps] of this.windows) {
        const last = timestamps[timestamps.length - 1];
        if (last === undefined || last < windowStart) this.windows.delete(k);
      }
    }
    return kept.length;
  }
}
