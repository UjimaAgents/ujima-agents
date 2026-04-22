import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type UjimaDb } from './index';

describe('context store', () => {
  let db: UjimaDb;

  beforeEach(() => {
    db = openDb({ dbPath: ':memory:', pollingIntervalMs: 20 });
  });

  afterEach(async () => {
    await db.close();
  });

  it('put/get round-trips arbitrary JSON', async () => {
    await db.context.put('task:t1:spec', { title: 'Profile card', steps: 3 });
    const v = await db.context.get<{ title: string; steps: number }>('task:t1:spec');
    expect(v).toEqual({ title: 'Profile card', steps: 3 });
  });

  it('returns undefined for missing key', async () => {
    const v = await db.context.get('missing');
    expect(v).toBeUndefined();
  });

  it('lists entries by prefix in order', async () => {
    await db.context.put('design:a', 1);
    await db.context.put('design:b', 2);
    await db.context.put('other:z', 99);
    const rows = await db.context.list('design:');
    expect(rows.map((r) => r.key)).toEqual(['design:a', 'design:b']);
  });

  it('delete removes keys', async () => {
    await db.context.put('k', 1);
    await db.context.delete('k');
    expect(await db.context.get('k')).toBeUndefined();
  });

  it('subscribe receives in-process updates', async () => {
    const handler = vi.fn();
    const unsub = db.context.subscribe('design:', handler);
    await db.context.put('design:token', { color: 'teal' });
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ key: 'design:token' });
    unsub();
  });

  it('subscribe ignores non-prefix updates', async () => {
    const handler = vi.fn();
    const unsub = db.context.subscribe('design:', handler);
    await db.context.put('other:x', 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).not.toHaveBeenCalled();
    unsub();
  });

  it('handles concurrent writes without losing entries', async () => {
    const writes = Array.from({ length: 50 }, (_, i) =>
      db.context.put(`batch:${i}`, { n: i }),
    );
    await Promise.all(writes);
    const rows = await db.context.list('batch:');
    expect(rows).toHaveLength(50);
  });
});
