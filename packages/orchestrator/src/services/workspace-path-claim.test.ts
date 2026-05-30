import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '@ujima/context-store';
import { OrganizationSchema } from '@ujima/shared';
import { Repository } from '@ujima/runtime-core';
import { createWorkspaceStore } from '@ujima/runtime-core';
import { reclaimOrphanOrganizationsAtPath } from './workspace-path-claim.js';
import { normalizeProjectFolderPath } from './workspace-root.js';

describe('reclaimOrphanOrganizationsAtPath', () => {
  it('deletes organizations at the path with no auth_users', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const workspaces = createWorkspaceStore(db);
    const home = mkdtempSync(join(tmpdir(), 'ujima-reclaim-'));
    try {
      const orphanId = randomUUID();
      repo.saveOrganization(
        OrganizationSchema.parse({
          id: orphanId,
          name: 'Zombie',
          workspace: { root: home, roleScopes: {} },
          organizationChart: { reportsTo: {} },
        }),
      );
      expect(repo.organizationHasAuthUsers(orphanId)).toBe(false);

      reclaimOrphanOrganizationsAtPath(
        repo,
        workspaces,
        normalizeProjectFolderPath(home),
      );

      expect(repo.getOrganization(orphanId)).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
