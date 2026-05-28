import { describe, it, expect } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from './repositories/index.js';

describe('decision_log ON CONFLICT against unique index', () => {
  it('rejects duplicate (org, source_message_id) via the unique index', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);

    repo.appendDecisionLogEntry({
      id: 'd1',
      organizationId: 'org-x',
      channelId: 'ch-1',
      decidedAt: '2026-01-01T00:00:00Z',
      decidedBy: 'mem-1',
      decisionText: 'first decision',
      sourceMessageId: 'msg-1',
      createdAt: '2026-01-01T00:00:00Z',
    });

    // Re-inserting with same source_message_id must NOT throw and must NOT persist
    expect(() =>
      repo.appendDecisionLogEntry({
        id: 'd2',
        organizationId: 'org-x',
        channelId: 'ch-1',
        decidedAt: '2026-01-02T00:00:00Z',
        decidedBy: 'mem-2',
        decisionText: 'second (should not persist)',
        sourceMessageId: 'msg-1',
        createdAt: '2026-01-02T00:00:00Z',
      }),
    ).not.toThrow();

    const list = repo.listDecisionLogForChannel('org-x', 'ch-1', 5);
    expect(list.length).toBe(1);
    const [only] = list;
    expect(only?.id).toBe('d1');
    expect(only?.decisionText).toBe('first decision');
  });
});
