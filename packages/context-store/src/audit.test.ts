import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type UjimaDb } from './index';

describe('audit log', () => {
  let db: UjimaDb;

  beforeEach(() => {
    db = openDb({ dbPath: ':memory:' });
  });

  afterEach(async () => {
    await db.close();
  });

  it('writes and queries records', async () => {
    await db.audit.write({
      event_id: 'e1',
      event_type: 'tool_call',
      agent_id: 'sr-designer',
      task_id: 't1',
      session_id: 's1',
      tool_name: 'figma.read',
      tool_input: { node: '1:2' },
      allowed: true,
    });
    const rows = await db.audit.query({ taskId: 't1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool_input).toEqual({ node: '1:2' });
    expect(rows[0]?.allowed).toBe(true);
  });

  it('filters by agent, session, event type', async () => {
    await db.audit.write({
      event_id: 'e1',
      event_type: 'tool_call',
      agent_id: 'a',
      task_id: 't',
      session_id: 's1',
      allowed: true,
    });
    await db.audit.write({
      event_id: 'e2',
      event_type: 'permission_check',
      agent_id: 'b',
      task_id: 't',
      session_id: 's2',
      allowed: false,
      block_reason: 'rate limited',
    });
    expect(await db.audit.count({ agentId: 'a' })).toBe(1);
    expect(await db.audit.count({ sessionId: 's2' })).toBe(1);
    expect(await db.audit.count({ eventType: 'permission_check' })).toBe(1);
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await db.audit.write({
        event_id: `e${i}`,
        event_type: 'tool_call',
        agent_id: 'a',
        task_id: 't',
        session_id: 's',
        allowed: true,
      });
    }
    const rows = await db.audit.query({ taskId: 't', limit: 2 });
    expect(rows).toHaveLength(2);
  });
});
