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

});
