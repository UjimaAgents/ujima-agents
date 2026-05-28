import { describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from './repositories/index.js';

describe('procedure_revisions append + history', () => {
  it('lists newest-first', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    for (let v = 1; v <= 3; v += 1) {
      repo.appendProcedureRevision({
        id: `rev-${v}`,
        organizationId: 'org-1',
        scope: 'org',
        scopeId: '',
        name: 'attribute-decisions',
        version: v,
        bodySnapshot: `body v${v}`,
        description: 'Tag decisions.',
        enforced: false,
        updatedBy: 'owner',
        updatedAt: `2026-05-${20 + v}T00:00:00Z`,
      });
    }
    const revisions = repo.listProcedureRevisions({
      organizationId: 'org-1',
      scope: 'org',
      scopeId: '',
      name: 'attribute-decisions',
    });
    expect(revisions).toHaveLength(3);
    expect(revisions[0]?.version).toBe(3);
    expect(revisions[1]?.version).toBe(2);
    expect(revisions[2]?.version).toBe(1);
    expect(revisions[0]?.bodySnapshot).toBe('body v3');
  });
});

describe('run_procedures_applied', () => {
  it('records and lists for a run', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    repo.recordProceduresApplied({
      organizationId: 'org-1',
      runId: 'run-A',
      applied: [
        { scope: 'org', scopeId: '', name: 'no-customer-data', version: 1, enforced: true },
        { scope: 'channel', scopeId: 'eng', name: 'design-tokens', version: 2, enforced: false },
      ],
    });
    const list = repo.listRunProceduresApplied('org-1', 'run-A');
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.name === 'no-customer-data')?.enforced).toBe(true);
  });

  it('upserts on retry (no duplicates)', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const applied = [
      { scope: 'agent', scopeId: 'layla', name: 'ping-phoebe', version: 1, enforced: false },
    ];
    repo.recordProceduresApplied({ organizationId: 'org-1', runId: 'run-X', applied });
    repo.recordProceduresApplied({
      organizationId: 'org-1',
      runId: 'run-X',
      applied: [{ ...applied[0]!, version: 2 }],
    });
    const list = repo.listRunProceduresApplied('org-1', 'run-X');
    expect(list).toHaveLength(1);
    expect(list[0]?.version).toBe(2);
  });
});
