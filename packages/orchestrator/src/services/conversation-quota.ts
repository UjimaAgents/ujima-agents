export class MentionQuota {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly cap: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.windows.get(key) ?? []).filter((sample) => sample > cutoff);
    if (recent.length >= this.cap) {
      this.windows.set(key, recent);
      return false;
    }
    recent.push(now);
    this.windows.set(key, recent);
    return true;
  }
}

export class ChannelReadQuota {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly cap: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.windows.get(key) ?? []).filter((sample) => sample > cutoff);
    if (recent.length >= this.cap) {
      this.windows.set(key, recent);
      return false;
    }
    recent.push(now);
    this.windows.set(key, recent);
    return true;
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
        if (last === undefined || last < windowStart) {
          this.windows.delete(k);
        }
      }
    }
    return kept.length;
  }
}
