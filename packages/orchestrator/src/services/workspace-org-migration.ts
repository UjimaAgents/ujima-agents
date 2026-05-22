import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Organization } from '@ujima/shared';
import {
  ACTIVE_WORKSPACE_SETTING_KEY,
  TEAM_CONFIG_SETTING_KEY,
} from './config-sync.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { orgWorkspaceId } from '@ujima/shared';
import { assertGrantableOwnerFromParentOrg } from './workspace-org-provision.js';
import { provisionOrganization } from './provision-organization.js';

export const ORGANIZATION_WORKSPACE_IDS_KEY = 'organization_workspace_ids';
const MIGRATION_DONE_KEY = 'workspace_org_unified_v1';

export interface WorkspaceCatalogRow {
  id: string;
  root_path: string | null;
  label: string | null;
}

export interface WorkspaceCatalogStore {
  list(): WorkspaceCatalogRow[];
  get(id: string): WorkspaceCatalogRow | undefined;
  create(input: {
    id?: string;
    root_path?: string | null;
    label?: string | null;
  }): WorkspaceCatalogRow;
  update(
    id: string,
    patch: Partial<Pick<WorkspaceCatalogRow, 'root_path' | 'label'>>,
  ): WorkspaceCatalogRow | undefined;
}

export interface WorkspaceOrgMigrationResult {
  migrated: boolean;
  splits: { fromOrganizationId: string; toOrganizationId: string; workspaceId: string }[];
}

function upsertOrganizationWorkspace(
  store: WorkspaceCatalogStore,
  organization: { id: string; name: string; workspace: { root: string } },
): void {
  const root = organization.workspace?.root?.trim();
  if (!root) return;

  const workspaceId = `ws_${organization.id}`;
  const normalizedRoot = resolve(root);
  const label = organization.name.trim() || 'Workspace';
  const existing = store.get(workspaceId);

  if (!existing) {
    store.create({
      id: workspaceId,
      root_path: normalizedRoot,
      label,
    });
    return;
  }

  const patch: Partial<Pick<WorkspaceCatalogRow, 'root_path' | 'label'>> = {};
  if (existing.root_path !== normalizedRoot) {
    patch.root_path = normalizedRoot;
  }
  if (label && existing.label !== label) {
    patch.label = label;
  }
  if (Object.keys(patch).length > 0) {
    store.update(workspaceId, patch);
  }
}

function readLinkedWorkspaceIds(repo: ApiRepository, organizationId: string): Set<string> {
  const raw = repo.getWorkspaceSetting(organizationId, ORGANIZATION_WORKSPACE_IDS_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

function workspaceLabel(row: WorkspaceCatalogRow, fallbackRoot: string): string {
  const label = row.label?.trim();
  if (label) return label;
  const parts = fallbackRoot.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? fallbackRoot;
}

function resolvePrimaryWorkspaceId(
  organization: Organization,
  linkedIds: Set<string>,
  activeId: string | null,
  workspaces: WorkspaceCatalogRow[],
): string {
  const defaultId = orgWorkspaceId(organization.id);
  if (linkedIds.has(defaultId)) return defaultId;
  const orgRoot = organization.workspace.root?.trim();
  if (orgRoot) {
    const match = workspaces.find(
      (ws) => ws.root_path && resolve(ws.root_path) === resolve(orgRoot),
    );
    if (match) return match.id;
  }
  if (activeId && linkedIds.has(activeId)) return activeId;
  return linkedIds.values().next().value ?? defaultId;
}

function splitWorkspaceToOrganization(input: {
  repo: ApiRepository;
  teamStore: TeamStore;
  parentOrganization: Organization;
  workspace: WorkspaceCatalogRow;
}): string {
  const { repo, teamStore, parentOrganization, workspace } = input;
  const rootPath = workspace.root_path?.trim();
  if (!rootPath) {
    throw new Error(`workspace "${workspace.id}" has no root_path`);
  }
  const resolvedRoot = resolve(rootPath);
  if (!existsSync(resolvedRoot)) {
    throw new Error(`workspace "${workspace.id}" root "${resolvedRoot}" does not exist on disk`);
  }
  assertGrantableOwnerFromParentOrg(repo, parentOrganization.id);

  const newOrganizationId = randomUUID();
  const name = workspaceLabel(workspace, resolvedRoot);

  const storedTeam = repo.getWorkspaceSetting(parentOrganization.id, TEAM_CONFIG_SETTING_KEY);
  const baseConfig = storedTeam
    ? (JSON.parse(storedTeam) as Record<string, unknown>)
    : {};

  provisionOrganization({
    repo,
    teamStore,
    organizationId: newOrganizationId,
    name,
    workspaceRoot: resolvedRoot,
    teamConfig: baseConfig,
    organizationChart: parentOrganization.organizationChart,
    owner: { kind: 'parent', parentOrganizationId: parentOrganization.id },
    credentialSourceOrganizationId: parentOrganization.id,
  });

  return newOrganizationId;
}

function saveLinkedWorkspaceIds(
  repo: ApiRepository,
  organizationId: string,
  workspaceIds: string[],
): void {
  const unique = [...new Set(workspaceIds.filter((id) => id.length > 0))];
  if (unique.length === 0) {
    repo.deleteWorkspaceSetting(organizationId, ORGANIZATION_WORKSPACE_IDS_KEY);
    return;
  }
  repo.saveWorkspaceSetting(
    organizationId,
    ORGANIZATION_WORKSPACE_IDS_KEY,
    JSON.stringify(unique),
  );
}

function cleanupLegacyWorkspaceSettings(repo: ApiRepository, organizationId: string): void {
  repo.deleteWorkspaceSetting(organizationId, ACTIVE_WORKSPACE_SETTING_KEY);
  repo.deleteWorkspaceSetting(organizationId, ORGANIZATION_WORKSPACE_IDS_KEY);
}

function markMigrationComplete(repo: ApiRepository, organizationId: string): void {
  cleanupLegacyWorkspaceSettings(repo, organizationId);
  repo.saveWorkspaceSetting(organizationId, MIGRATION_DONE_KEY, '1');
}

function alignOrganizationToWorkspace(
  repo: ApiRepository,
  workspaces: WorkspaceCatalogStore,
  organization: Organization,
  workspaceId: string,
): Organization {
  const row = workspaces.get(workspaceId);
  const root = row?.root_path?.trim()
    ? resolve(row.root_path)
    : organization.workspace.root;
  const updated = repo.saveOrganization({
    ...organization,
    name: organization.name,
    workspace: {
      ...organization.workspace,
      root,
    },
  });
  return updated;
}

/**
 * One-shot migration: multiple linked workspace folders under one org become
 * separate organizations (1 org = 1 workspace root). Idempotent via workspace_settings flag.
 */
export function migrateUnifiedWorkspaceOrg(input: {
  repo: ApiRepository;
  teamStore: TeamStore;
  workspaces: WorkspaceCatalogStore;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void };
}): WorkspaceOrgMigrationResult {
  const { repo, teamStore, workspaces, logger } = input;
  const splits: WorkspaceOrgMigrationResult['splits'] = [];

  for (const org of repo.listOrganizations()) {
    if (repo.getWorkspaceSetting(org.id, MIGRATION_DONE_KEY)) continue;

    const linkedIds = readLinkedWorkspaceIds(repo, org.id);
    const activeId = repo.getWorkspaceSetting(org.id, ACTIVE_WORKSPACE_SETTING_KEY);
    const catalogRows = workspaces.list();
    const needsSplit =
      linkedIds.size > 1 ||
      (activeId !== null && activeId !== orgWorkspaceId(org.id) && linkedIds.size > 0);

    if (needsSplit) {
      const primaryId = resolvePrimaryWorkspaceId(org, linkedIds, activeId, catalogRows);
      const extras = [...linkedIds].filter((id) => id !== primaryId);
      const failedWorkspaceIds: string[] = [];

      for (const workspaceId of extras) {
        const row = workspaces.get(workspaceId);
        if (!row?.root_path?.trim()) {
          failedWorkspaceIds.push(workspaceId);
          logger?.info('workspace-org-migration: split skipped (missing root_path)', {
            organizationId: org.id,
            workspaceId,
          });
          continue;
        }
        try {
          const newOrgId = splitWorkspaceToOrganization({
            repo,
            teamStore,
            parentOrganization: org,
            workspace: row,
          });
          splits.push({
            fromOrganizationId: org.id,
            toOrganizationId: newOrgId,
            workspaceId,
          });
          logger?.info('workspace-org-migration: split workspace to new organization', {
            fromOrganizationId: org.id,
            toOrganizationId: newOrgId,
            workspaceId,
          });
        } catch (err) {
          failedWorkspaceIds.push(workspaceId);
          logger?.info('workspace-org-migration: split failed', {
            organizationId: org.id,
            workspaceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      alignOrganizationToWorkspace(repo, workspaces, org, primaryId);

      if (failedWorkspaceIds.length > 0) {
        saveLinkedWorkspaceIds(repo, org.id, [primaryId, ...failedWorkspaceIds]);
        logger?.info('workspace-org-migration: split incomplete, legacy linkage retained', {
          organizationId: org.id,
          failedWorkspaceIds,
        });
        continue;
      }

      markMigrationComplete(repo, org.id);
    } else {
      upsertOrganizationWorkspace(workspaces, org);
      if (activeId) {
        alignOrganizationToWorkspace(repo, workspaces, org, activeId);
      }
      markMigrationComplete(repo, org.id);
    }
  }

  return {
    migrated: splits.length > 0,
    splits,
  };
}
