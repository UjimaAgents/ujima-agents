import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OrganizationSchema } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import { reclaimOrphanOrganizationsAtPath } from './workspace-path-claim.js';
import { normalizeProjectFolderPath } from './workspace-root.js';
import type { WorkspaceCatalog } from './workspace.js';

describe('reclaimOrphanOrganizationsAtPath', () => {
  it('deletes organizations at the path with no auth_users', () => {
    const home = mkdtempSync(join(tmpdir(), 'ujima-reclaim-'));
    try {
      const orphan = OrganizationSchema.parse({
        id: randomUUID(),
        name: 'Zombie',
        workspace: { root: home, roleScopes: {} },
        organizationChart: { reportsTo: {} },
      });
      const deleted: string[] = [];
      const repo: ApiRepository = {
        listOrganizations: () => [orphan],
        organizationHasAuthUsers: () => false,
        deleteOrganizationData: (id: string) => { deleted.push(id); },
        getOrganization: () => null,
      } as unknown as ApiRepository;
      const workspaces: WorkspaceCatalog = {};

      reclaimOrphanOrganizationsAtPath(repo, workspaces, normalizeProjectFolderPath(home));
      expect(deleted).toEqual([orphan.id]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('does not delete organizations with auth users', () => {
    const home = mkdtempSync(join(tmpdir(), 'ujima-reclaim-auth-'));
    try {
      const active = OrganizationSchema.parse({
        id: randomUUID(),
        name: 'Active Org',
        workspace: { root: home, roleScopes: {} },
        organizationChart: { reportsTo: {} },
      });
      const deleted: string[] = [];
      const repo: ApiRepository = {
        listOrganizations: () => [active],
        organizationHasAuthUsers: () => true,
        deleteOrganizationData: (id: string) => { deleted.push(id); },
        getOrganization: () => null,
      } as unknown as ApiRepository;
      const workspaces: WorkspaceCatalog = {};

      reclaimOrphanOrganizationsAtPath(repo, workspaces, normalizeProjectFolderPath(home));
      expect(deleted).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
