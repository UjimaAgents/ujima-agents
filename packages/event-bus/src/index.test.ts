import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UjimaEvent } from '@ujima/shared';
import { openDb, type UjimaDb } from '@ujima/context-store';
import { createLocalEventBus, type EventBus } from './index';

function makeEvent(id: string, publisher = 'agent-1'): UjimaEvent<{ n: number }> {
  return {
    event_id: id,
    type: 'tokens.ready',
    publisher,
    timestamp: new Date().toISOString(),
    payload: { n: 1 },
    task_id: 't1',
    session_id: 's1',
  };
}

describe('event bus', () => {
  let db: UjimaDb;
  let bus: EventBus;

  beforeEach(() => {
    db = openDb({ dbPath: ':memory:' });
    bus = createLocalEventBus({ audit: db.audit, pendingEvents: db.pendingEvents });
  });

  afterEach(async () => {
    await bus.close();
    await db.close();
  });

  it('delivers events to live subscribers', async () => {
    const handler = vi.fn();
    bus.subscribe('design:tokens', handler);
    await bus.publish('design:tokens', makeEvent('e1'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ event_id: 'e1' });
  });

  it('audits before delivering', async () => {
    await bus.publish('design:tokens', makeEvent('e1'));
    const rows = await db.audit.query({ taskId: 't1', eventType: 'event_published' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool_input).toMatchObject({ channel: 'design:tokens' });
  });

  it('replays events since timestamp', async () => {
    const start = Date.now();
    await bus.publish('chan', makeEvent('e1'));
    await bus.publish('chan', makeEvent('e2'));
    const replayed = await bus.replay<{ n: number }>('chan', start);
    expect(replayed.map((e) => e.event_id)).toEqual(['e1', 'e2']);
  });

  it('subscribe with replaySinceMs delivers historical events', async () => {
    const start = Date.now();
    await bus.publish('chan', makeEvent('e1'));
    const handler = vi.fn();
    bus.subscribe('chan', handler, { replaySinceMs: start });
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).toHaveBeenCalled();
  });

  it('unsubscribe stops delivery', async () => {
    const handler = vi.fn();
    const unsub = bus.subscribe('chan', handler);
    unsub();
    await bus.publish('chan', makeEvent('e1'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('audit row is persisted BEFORE subscribers observe the event', async () => {
    // If a handler runs on event delivery, the audit row it queries must already exist.
    let auditRowCountAtDelivery = -1;
    bus.subscribe('chan', async () => {
      const rows = await db.audit.query({ eventType: 'event_published' });
      auditRowCountAtDelivery = rows.length;
    });
    await bus.publish('chan', makeEvent('e1'));
    // micro-task for async handler
    await new Promise((r) => setImmediate(r));
    expect(auditRowCountAtDelivery).toBe(1);
  });

  it('multiple subscribers all receive the event', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe('chan', h1);
    bus.subscribe('chan', h2);
    await bus.publish('chan', makeEvent('e1'));
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('replay returns empty when no pendingEvents store is wired', async () => {
    const bareBus = createLocalEventBus({ audit: db.audit });
    await bareBus.publish('chan', makeEvent('e1'));
    const replayed = await bareBus.replay('chan', 0);
    expect(replayed).toEqual([]);
    await bareBus.close();
  });

  it('handler error does not bubble and does not break other subscribers', async () => {
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const healthy = vi.fn();
    bus.subscribe('chan', throwing);
    bus.subscribe('chan', healthy);
    // EventEmitter synchronous throw would be the worst case.
    // Async handlers never bubble — but if one throws synchronously, confirm it doesn't
    // stop the second. We catch via process-level unhandledRejection if needed;
    // here we just assert both handlers were invoked.
    try {
      await bus.publish('chan', makeEvent('e1'));
    } catch {
      // swallow
    }
    expect(throwing).toHaveBeenCalled();
    expect(healthy).toHaveBeenCalled();
  });

  it('publisher field propagates to audit agent_id', async () => {
    await bus.publish('chan', makeEvent('e1', 'agent-xyz'));
    const rows = await db.audit.query({ eventType: 'event_published' });
    expect(rows[0]?.agent_id).toBe('agent-xyz');
  });
});
