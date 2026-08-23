export interface OnboardingAttemptLifecycleOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/** Owns onboarding retry identity and the single-process admission gate. */
export class OnboardingAttemptLifecycle<T> {
  private readonly completed = new Map<string, { requestKey: string; response: T; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private inFlight = false;

  constructor(options: OnboardingAttemptLifecycleOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.maxEntries = options.maxEntries ?? 32;
    this.now = options.now ?? Date.now;
  }

  getCompleted(attemptId: string, requestKey: string): T | undefined {
    this.prune();
    const entry = this.completed.get(attemptId);
    return entry?.requestKey === requestKey ? entry.response : undefined;
  }

  begin(): boolean {
    this.prune();
    if (this.inFlight) return false;
    this.inFlight = true;
    return true;
  }

  complete(attemptId: string | undefined, requestKey: string, response: T): void {
    if (!attemptId) return;
    this.completed.set(attemptId, {
      requestKey,
      response,
      expiresAt: this.now() + this.ttlMs,
    });
    while (this.completed.size > this.maxEntries) {
      const oldest = this.completed.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.completed.delete(oldest);
    }
  }

  release(): void {
    this.inFlight = false;
  }

  private prune(): void {
    const now = this.now();
    for (const [attemptId, entry] of this.completed) {
      if (entry.expiresAt <= now) this.completed.delete(attemptId);
    }
  }
}
