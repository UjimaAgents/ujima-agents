import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadAgentTeam } from '@ujima/framework';
import {
  ACTIVE_WORKSPACE_SETTING_KEY,
  ConfigSyncService,
  TEAM_CONFIG_SETTING_KEY,
  copyProviderCredentials,
  grantWorkspaceOwnerFromParentOrg,
  orgWorkspaceId,
  persistTeamConfig,
  type ApiRepository,
  type TeamStore,
} from '@ujima/orchestrator';
import { OrganizationSchema, type Organization } from '@ujima/shared';
import { syncWorkspacesFromOrganizations, type WorkspaceStore } from './workspaces.js';

export const ORGANIZATION_WORKSPACE_IDS_KEY = 'organization_workspace_ids';
const MIGRATION_DONE_KEY = 'workspace_org_unified_v1';

export interface WorkspaceCatalogRow {
  id: string;
  root_path: string | null;
  label: string | null;
}

export interface WorkspaceOrgMigrationResult {
  migrated: boolean;
  splits: { fromOrganizationId: string; toOrganizationId: string; workspaceId: string }[];
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
  workspaces: WorkspaceStore;
  parentOrganization: Organization;
  workspace: WorkspaceCatalogRow;
}): string {
  const { repo, teamStore, workspaces, parentOrganization, workspace } = input;
  const rootPath = workspace.root_path?.trim();
  if (!rootPath) {
    throw new Error(`workspace "${workspace.id}" has no root_path`);
  }
  const resolvedRoot = resolve(rootPath);
  const newOrganizationId = randomUUID();
  const name = workspaceLabel(workspace, resolvedRoot);

  const storedTeam = repo.getWorkspaceSetting(parentOrganization.id, TEAM_CONFIG_SETTING_KEY);
  const baseConfig = storedTeam
    ? (JSON.parse(storedTeam) as Record<string, unknown>)
    : {};
  const teamConfig = {
    ...baseConfig,
    name,
    workspace: {
      root: resolvedRoot,
      roleScopes: {} as Record<string, string[]>,
    },
  };

  const organization = OrganizationSchema.parse({
    id: newOrganizationId,
    name,
    workspace: {
      root: resolvedRoot,
      roleScopes: {},
    },
    organizationChart: parentOrganization.organizationChart,
  });
  repo.saveOrganization(organization);

  const team = loadAgentTeam(teamConfig);
  persistTeamConfig(repo, newOrganizationId, team);

  const configSync = new ConfigSyncService(repo, teamStore);
  configSync.reconcileTeamConfig({
    team,
    organizationId: newOrganizationId,
  });

  const newOwnerId = randomUUID();
  grantWorkspaceOwnerFromParentOrg(repo, parentOrganization.id, newOrganizationId, newOwnerId);
  copyProviderCredentials(repo, parentOrganization.id, newOrganizationId);

  syncWorkspacesFromOrganizations(workspaces, [organization]);

  return newOrganizationId;
}

function cleanupLegacyWorkspaceSettings(repo: ApiRepository, organizationId: string): void {
  repo.deleteWorkspaceSetting(organizationId, ACTIVE_WORKSPACE_SETTING_KEY);
  repo.deleteWorkspaceSetting(organizationId, ORGANIZATION_WORKSPACE_IDS_KEY);
}

function alignOrganizationToWorkspace(
  repo: ApiRepository,
  workspaces: WorkspaceStore,
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
  syncWorkspacesFromOrganizations(workspaces, [updated]);
  return updated;
}

/**
 * One-shot migration: multiple linked workspace folders under one org become
 * separate organizations (1 org = 1 workspace root). Idempotent via workspace_settings flag.
 */
export function migrateUnifiedWorkspaceOrg(input: {
  repo: ApiRepository;
  teamStore: TeamStore;
  workspaces: WorkspaceStore;
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

      for (const workspaceId of extras) {
        const row = workspaces.get(workspaceId);
        if (!row?.root_path?.trim()) continue;
        try {
          const newOrgId = splitWorkspaceToOrganization({
            repo,
            teamStore,
            workspaces,
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
          logger?.info('workspace-org-migration: split failed', {
            organizationId: org.id,
            workspaceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      alignOrganizationToWorkspace(repo, workspaces, org, primaryId);
      cleanupLegacyWorkspaceSettings(repo, org.id);
    } else {
      syncWorkspacesFromOrganizations(workspaces, [org]);
      if (activeId) {
        alignOrganizationToWorkspace(repo, workspaces, org, activeId);
      }
      cleanupLegacyWorkspaceSettings(repo, org.id);
    }

    repo.saveWorkspaceSetting(org.id, MIGRATION_DONE_KEY, '1');
  }

  return {
    migrated: splits.length > 0 || repo.listOrganizations().length > 0,
    splits,
  };
}
