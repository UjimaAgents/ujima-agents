import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UjimaEvent } from '@ujima/shared';
import { openDb, type UjimaDb } from './index';

function event(id: string, type = 'test'): UjimaEvent<{ n: number }> {
  return {
    event_id: id,
    type,
    publisher: 'test',
    timestamp: new Date().toISOString(),
    payload: { n: 1 },
  };
}

describe('pending events', () => {
  let db: UjimaDb;

  beforeEach(() => {
    db = openDb({ dbPath: ':memory:' });
  });

  afterEach(async () => {
    await db.close();
  });

  it('stores and replays since a timestamp', async () => {
    const before = Date.now();
    await db.pendingEvents.add('design:tokens', event('e1'));
    await db.pendingEvents.add('design:tokens', event('e2'));
    const rows = await db.pendingEvents.listSince('design:tokens', before);
    expect(rows.map((r) => r.event.event_id)).toEqual(['e1', 'e2']);
  });

  it('purgeExpired removes only past entries', async () => {
    await db.pendingEvents.add('c', event('e1'), -1);
    await db.pendingEvents.add('c', event('e2'), 60_000);
    const purged = await db.pendingEvents.purgeExpired();
    expect(purged).toBe(1);
    const remaining = await db.pendingEvents.listByChannel('c');
    expect(remaining.map((r) => r.event.event_id)).toEqual(['e2']);
  });
});
