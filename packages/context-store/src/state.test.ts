import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type UjimaDb } from './index';

describe('agent + task state', () => {
  let db: UjimaDb;

  beforeEach(() => {
    db = openDb({ dbPath: ':memory:' });
  });

  afterEach(async () => {
    await db.close();
  });

  it('upserts agent state and updates patches', async () => {
    await db.agentState.upsert('agent-1', { status: 'active', last_action: 'spawn' });
    let s = await db.agentState.get('agent-1');
    expect(s?.status).toBe('active');
    expect(s?.last_action).toBe('spawn');
    await db.agentState.upsert('agent-1', { last_action: 'figma.read' });
    s = await db.agentState.get('agent-1');
    expect(s?.status).toBe('active');
    expect(s?.last_action).toBe('figma.read');
  });

  it('increments tokens and calls', async () => {
    await db.agentState.upsert('a', { status: 'active' });
    await db.agentState.incrementTokens('a', 500);
    await db.agentState.incrementTokens('a', 250);
    await db.agentState.incrementCalls('a');
    await db.agentState.incrementCalls('a');
    const s = await db.agentState.get('a');
    expect(s?.tokens_used).toBe(750);
    expect(s?.calls_made).toBe(2);
  });

  it('heartbeat updates last_heartbeat', async () => {
    await db.agentState.heartbeat('a');
    const s = await db.agentState.get('a');
    expect(s?.last_heartbeat).toBeTypeOf('number');
  });

  it('task lifecycle transitions', async () => {
    await db.taskState.start('t1', { prompt: 'build card' });
    let t = await db.taskState.get('t1');
    expect(t?.status).toBe('running');
    expect(t?.metadata).toEqual({ prompt: 'build card' });
    await db.taskState.setStatus('t1', 'paused');
    t = await db.taskState.get('t1');
    expect(t?.status).toBe('paused');
    await db.taskState.end('t1', 'complete');
    t = await db.taskState.get('t1');
    expect(t?.status).toBe('complete');
    expect(t?.ended_at).toBeTypeOf('number');
  });
});
