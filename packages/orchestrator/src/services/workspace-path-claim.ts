import { organizationIdFromWorkspaceId } from '@ujima/shared';
import type { Organization } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import { normalizeProjectFolderPath } from './workspace-root.js';
import type { WorkspaceCatalog, WorkspaceCatalogRow } from './workspace.js';

function orgRootMatches(org: Organization, normalizedPath: string): boolean {
  const root = org.workspace?.root?.trim();
  if (!root) return false;
  return normalizeProjectFolderPath(root) === normalizedPath;
}

export function reclaimOrphanOrganizationsAtPath(
  repo: ApiRepository,
  workspaces: WorkspaceCatalog,
  normalizedPath: string,
): void {
  for (const org of repo.listOrganizations()) {
    if (!orgRootMatches(org, normalizedPath)) continue;
    if (repo.organizationHasAuthUsers(org.id)) continue;
    repo.deleteOrganizationData(org.id);
  }

  sweepOrphanCatalogRowsAtPath(repo, workspaces, normalizedPath);
}

export function assertProjectFolderAvailable(
  repo: ApiRepository,
  accessibleOrgs: Organization[],
  normalizedPath: string,
  currentOrganizationId: string,
): void {
  for (const org of accessibleOrgs) {
    if (!orgRootMatches(org, normalizedPath)) continue;
    if (org.id === currentOrganizationId) {
      throw new Error(
        `This folder is already used by your active workspace "${org.name}". Switch to another workspace first if you want a separate organization here.`,
      );
    }
    throw new Error(`A workspace with the project folder "${org.workspace?.root}" already exists.`);
  }
}

export function sweepOrphanCatalogRowsAtPath(
  repo: ApiRepository,
  workspaces: WorkspaceCatalog,
  normalizedPath: string,
): void {
  const rows = workspaces.list?.() ?? [];
  for (const row of rows) {
    if (!row.root_path) continue;
    if (normalizeProjectFolderPath(row.root_path) !== normalizedPath) continue;
    const orgId = organizationIdFromWorkspaceId(row.id);
    if (orgId && repo.getOrganization(orgId)) continue;
    workspaces.remove?.(row.id);
  }
}

export type { WorkspaceCatalogRow };
