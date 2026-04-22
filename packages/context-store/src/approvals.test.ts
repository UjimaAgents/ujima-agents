import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type UjimaDb } from './index';

describe('approval tracker', () => {
  let db: UjimaDb;

  beforeEach(() => {
    db = openDb({ dbPath: ':memory:' });
  });

  afterEach(async () => {
    await db.close();
  });

  it('proposes a pending approval', async () => {
    await db.approvals.propose({
      id: 'ap1',
      task_id: 't1',
      artifact_key: 'design:tokens',
      domain: 'figma',
      proposed_by: 'sr-designer',
    });
    const rec = await db.approvals.get('ap1');
    expect(rec?.status).toBe('pending_approval');
    expect(rec?.proposed_by).toBe('sr-designer');
  });

  it('decides approved and records decider + reason', async () => {
    await db.approvals.propose({
      id: 'ap1',
      task_id: 't1',
      artifact_key: 'k',
      domain: 'figma',
      proposed_by: 'a',
    });
    await db.approvals.decide('ap1', {
      status: 'approved',
      approved_by: 'human',
      reason: 'LGTM',
    });
    const rec = await db.approvals.get('ap1');
    expect(rec?.status).toBe('approved');
    expect(rec?.approved_by).toBe('human');
    expect(rec?.decided_at).toBeTypeOf('number');
  });

  it('lists by task and filters by status', async () => {
    await db.approvals.propose({
      id: 'a',
      task_id: 't',
      artifact_key: 'k1',
      domain: 'figma',
      proposed_by: 'x',
    });
    await db.approvals.propose({
      id: 'b',
      task_id: 't',
      artifact_key: 'k2',
      domain: 'figma',
      proposed_by: 'x',
    });
    await db.approvals.decide('a', { status: 'approved', approved_by: 'h' });
    const all = await db.approvals.listByTask('t');
    const pending = await db.approvals.listByTask('t', 'pending_approval');
    const approvedByDomain = await db.approvals.listApprovedByDomain('t', 'figma');
    expect(all).toHaveLength(2);
    expect(pending).toHaveLength(1);
    expect(approvedByDomain.map((r) => r.id)).toEqual(['a']);
  });
});
