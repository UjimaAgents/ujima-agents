export class AsyncMutex {
  private readonly store = new Map<string, Promise<unknown>>();

  async run<T>(key: string, body: () => Promise<T>): Promise<T> {
    const previous = this.store.get(key) ?? Promise.resolve();
    const next = previous.then(body, body);
    this.store.set(
      key,
      next.catch(() => undefined).finally(() => {
        if (this.store.get(key) === next) {
          this.store.delete(key);
        }
      }),
    );
    return next;
  }

  size(): number {
    return this.store.size;
  }
}
