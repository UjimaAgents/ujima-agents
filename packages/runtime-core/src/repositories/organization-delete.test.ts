import { describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { OrganizationSchema } from '@ujima/shared';
import { deleteOrganizationData } from './organization.js';
import { Repository } from './index.js';

describe('deleteOrganizationData', () => {
  it('removes procedure culture rows including run_procedures_applied', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const org = repo.saveOrganization(
      OrganizationSchema.parse({
        id: 'org-teardown-procedures',
        name: 'Teardown Procedures Org',
        workspace: { root: '/tmp/teardown-procedures', roleScopes: {} },
        organizationChart: { reportsTo: {} },
      }),
    );

    repo.appendProcedureRevision({
      id: 'rev-1',
      organizationId: org.id,
      scope: 'org',
      scopeId: '',
      name: 'standup-format',
      version: 1,
      bodySnapshot: 'body',
      description: 'Standup norms',
      enforced: false,
      updatedBy: 'owner',
      updatedAt: '2026-05-29T00:00:00.000Z',
    });
    repo.recordProceduresApplied({
      organizationId: org.id,
      runId: 'run-teardown',
      applied: [{ scope: 'org', scopeId: '', name: 'standup-format', version: 1, enforced: false }],
    });

    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM run_procedures_applied WHERE organization_id = ?')
        .get(org.id) as { n: number },
    ).toEqual({ n: 1 });

    deleteOrganizationData(db, org.id);

    expect(repo.getOrganization(org.id)).toBeNull();
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM procedure_revisions WHERE organization_id = ?').get(org.id) as
        | { n: number }
        | undefined,
    ).toEqual({ n: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM run_procedures_applied WHERE organization_id = ?').get(org.id) as
        | { n: number }
        | undefined,
    ).toEqual({ n: 0 });
  });
});
