import { randomUUID } from 'node:crypto';
import { createEmptyWorkspaceTeamConfig, type ProviderConfig, loadAgentTeam } from '@ujima/framework';
import type { Organization } from '@ujima/shared';
import type { AuthService } from './auth.js';
import { assertWorkspaceRootPathExists, normalizeProjectFolderPath } from './workspace-root.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { provisionOrganization } from './provision-organization.js';
import { TEAM_CONFIG_SETTING_KEY } from './config-sync.js';
import {
  assertProjectFolderAvailable,
  reclaimOrphanOrganizationsAtPath,
  sweepOrphanCatalogRowsAtPath,
} from './workspace-path-claim.js';
import { orgWorkspaceId, organizationIdFromWorkspaceId } from '@ujima/shared';

export interface WorkspaceListItem {
  id: string;
  root_path: string | null;
  label: string | null;
  created_at: number;
  updated_at: number;
  is_current?: boolean;
}

export interface ListAccessibleWorkspacesResult {
  workspaces: WorkspaceListItem[];
  current_workspace_id: string | null;
  current_root_path: string | null;
}

export interface CreateWorkspaceInput {
  organizationName: string;
  workspaceRoot: string;
  copyProviderKeys?: string[];
}

export interface DuplicateWorkspaceInput {
  sourceWorkspaceId: string;
  organizationName: string;
  workspaceRoot: string;
  copyOptions: {
    providerKeys: string[];
    providerConfigs: boolean;
    agents: boolean;
    roles: boolean;
    channels: boolean;
    tools: boolean;
    policies: boolean;
    orgChart: boolean;
  };
}

export interface WorkspaceCatalogRow {
  id: string;
  root_path: string | null;
  label: string | null;
  created_at: number;
  updated_at: number;
}

export interface WorkspaceCatalog {
  get(id: string): WorkspaceCatalogRow | undefined;
  list?(): WorkspaceCatalogRow[];
  remove?(id: string): boolean;
}

function toWorkspaceListItem(
  organization: Organization,
  row: {
    id: string;
    root_path: string | null;
    label: string | null;
    created_at: number;
    updated_at: number;
  },
  isCurrent: boolean,
): WorkspaceListItem {
  return {
    id: row.id,
    root_path: row.root_path ?? organization.workspace?.root ?? null,
    label: organization.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_current: isCurrent,
  };
}

export class WorkspaceService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly teamStore: TeamStore,
    private readonly workspaces: WorkspaceCatalog,
    private readonly auth: AuthService,
  ) {}

  listAccessible(sessionToken?: string | null): ListAccessibleWorkspacesResult {
    const authState = this.auth.getAuthState(sessionToken);
    if (!authState.authenticated || !authState.user) {
      throw new Error('session required');
    }

    const currentOrganizationId = authState.user.organizationId;
    const organizations = this.auth.listAccessibleOrganizations(sessionToken);

    const workspaces: WorkspaceListItem[] = [];
    let currentWorkspaceId: string | null = null;
    let currentRootPath: string | null = null;

    for (const organization of organizations) {
      const workspaceId = orgWorkspaceId(organization.id);
      const row = this.workspaces.get(workspaceId);
      if (!row) continue;
      const isCurrent = organization.id === currentOrganizationId;
      if (isCurrent) {
        currentWorkspaceId = row.id;
        currentRootPath =
          row.root_path?.trim() || organization.workspace?.root?.trim() || null;
      }
      workspaces.push(toWorkspaceListItem(organization, row, isCurrent));
    }

    return {
      workspaces,
      current_workspace_id: currentWorkspaceId,
      current_root_path: currentRootPath,
    };
  }

  private resolveWorkspaceCreationContext(
    sessionToken: string | null | undefined,
    workspaceRoot: string,
    organizationName: string,
  ) {
    const authState = this.auth.getAuthState(sessionToken);
    if (!authState.authenticated || !authState.user || !authState.member) {
      throw new Error('session required');
    }

    const name = organizationName.trim();
    if (!name) {
      throw new Error('workspace name is required');
    }

    const root = assertWorkspaceRootPathExists(workspaceRoot);
    const normalizedRoot = normalizeProjectFolderPath(root);

    reclaimOrphanOrganizationsAtPath(this.repo, this.workspaces, normalizedRoot);

    const allOrgs = this.repo.listOrganizations();
    assertProjectFolderAvailable(
      this.repo,
      allOrgs,
      normalizedRoot,
      authState.user.organizationId,
    );

    return {
      ownerOrganizationId: authState.user.organizationId,
      ownerMemberId: authState.member.id,
      organizationName: name,
      workspaceRoot: root,
      normalizedRoot,
    };
  }

  createWorkspace(
    sessionToken: string | null | undefined,
    input: CreateWorkspaceInput,
  ): WorkspaceListItem {
    const { ownerOrganizationId, ownerMemberId, organizationName, workspaceRoot } =
      this.resolveWorkspaceCreationContext(sessionToken, input.workspaceRoot, input.organizationName);

    const templateOrganization = this.repo.getOrganization(ownerOrganizationId);
    if (!templateOrganization) {
      throw new Error('current workspace was not found');
    }

    const copyProviderKeys = input.copyProviderKeys ?? [];
    const teamConfig = createEmptyWorkspaceTeamConfig({
      name: organizationName,
      workspaceRoot,
      providers:
        copyProviderKeys.length > 0
          ? Object.fromEntries(
              copyProviderKeys
                .filter((key) => this.repo.listProviderCredentials(ownerOrganizationId)[key] != null)
                .map((key) => [key, { kind: key } as ProviderConfig]),
            )
          : {},
    });

    const organization = provisionOrganization({
      repo: this.repo,
      teamStore: this.teamStore,
      organizationId: randomUUID(),
      name: organizationName,
      workspaceRoot,
      teamConfig,
      owner: {
        kind: 'member',
        templateOrganizationId: ownerOrganizationId,
        templateMemberId: ownerMemberId,
      },
      credentialSourceOrganizationId: ownerOrganizationId,
      copyProviderKeys,
    });

    const workspaceId = orgWorkspaceId(organization.id);
    const now = Date.now();
    return {
      id: workspaceId,
      root_path: workspaceRoot,
      label: organization.name,
      created_at: now,
      updated_at: now,
      is_current: false,
    };
  }

  duplicateWorkspace(
    sessionToken: string | null | undefined,
    input: DuplicateWorkspaceInput,
  ): WorkspaceListItem {
    const { ownerOrganizationId, ownerMemberId, organizationName, workspaceRoot } =
      this.resolveWorkspaceCreationContext(sessionToken, input.workspaceRoot, input.organizationName);

    const sourceWorkspaceId = input.sourceWorkspaceId;
    const sourceOrganizationId = organizationIdFromWorkspaceId(sourceWorkspaceId);
    if (!sourceOrganizationId) {
      throw new Error('Invalid source workspace ID');
    }

    const organizations = this.auth.listAccessibleOrganizations(sessionToken);
    if (!organizations.some((org) => org.id === sourceOrganizationId)) {
      throw new Error('Source workspace not found or access denied');
    }

    const sourceOrg = this.repo.getOrganization(sourceOrganizationId);
    if (!sourceOrg) {
      throw new Error('Source workspace not found');
    }

    const storedConfig = this.repo.getWorkspaceSetting(sourceOrganizationId, TEAM_CONFIG_SETTING_KEY);
    if (!storedConfig) {
      throw new Error('Source workspace has no team configuration to duplicate');
    }

    let sourceTeamConfig: Record<string, unknown>;
    try {
      sourceTeamConfig = JSON.parse(storedConfig) as Record<string, unknown>;
    } catch {
      throw new Error('Source workspace has invalid team configuration');
    }

    const { copyOptions } = input;

    const baseConfig = createEmptyWorkspaceTeamConfig({
      name: organizationName,
      workspaceRoot,
    });

    if (copyOptions.providerConfigs && sourceTeamConfig.providers) {
      baseConfig.providers = { ...sourceTeamConfig.providers } as Record<string, ProviderConfig>;
    }

    if (copyOptions.agents && Array.isArray(sourceTeamConfig.agents)) {
      baseConfig.agents = [...sourceTeamConfig.agents];
    }

    if (copyOptions.roles && Array.isArray(sourceTeamConfig.roles)) {
      baseConfig.roles = [...sourceTeamConfig.roles];
    }

    if (copyOptions.channels && Array.isArray(sourceTeamConfig.channels)) {
      baseConfig.channels = [...sourceTeamConfig.channels];
    }

    if (copyOptions.tools && sourceTeamConfig.tools) {
      baseConfig.tools = { ...sourceTeamConfig.tools };
    }

    if (copyOptions.policies && sourceTeamConfig.policies) {
      baseConfig.policies = { ...baseConfig.policies, ...sourceTeamConfig.policies } as typeof baseConfig.policies;
    }

    if (copyOptions.orgChart && sourceTeamConfig.organizationChart) {
      baseConfig.organizationChart = { ...baseConfig.organizationChart, ...sourceTeamConfig.organizationChart } as typeof baseConfig.organizationChart;
    }

    const team = loadAgentTeam(baseConfig);

    const organization = provisionOrganization({
      repo: this.repo,
      teamStore: this.teamStore,
      organizationId: randomUUID(),
      name: organizationName,
      workspaceRoot,
      teamConfig: team.toJSON(),
      owner: {
        kind: 'member',
        templateOrganizationId: ownerOrganizationId,
        templateMemberId: ownerMemberId,
      },
      credentialSourceOrganizationId: sourceOrganizationId,
      copyProviderKeys: copyOptions.providerKeys,
    });

    const workspaceId = orgWorkspaceId(organization.id);
    const now = Date.now();
    return {
      id: workspaceId,
      root_path: workspaceRoot,
      label: organization.name,
      created_at: now,
      updated_at: now,
      is_current: false,
    };
  }

  deleteWorkspace(
    sessionToken: string | null | undefined,
    workspaceId: string,
  ): void {
    const authState = this.auth.getAuthState(sessionToken);
    if (!authState.authenticated || !authState.user) {
      throw new Error('session required');
    }

    const organizationId = organizationIdFromWorkspaceId(workspaceId);
    if (!organizationId) {
      throw new Error('Invalid workspace ID');
    }

    if (organizationId === authState.user.organizationId) {
      throw new Error('Cannot delete the currently active workspace. Switch to another workspace first.');
    }

    const organizations = this.auth.listAccessibleOrganizations(sessionToken);
    if (!organizations.some((org) => org.id === organizationId)) {
      throw new Error('Workspace not found or access denied');
    }

    const deletedOrg = this.repo.getOrganization(organizationId);
    const deletedRoot = deletedOrg?.workspace?.root;

    this.repo.deleteOrganizationData(organizationId);
    this.teamStore.clearTeam(organizationId);
    if (this.workspaces.remove) {
      this.workspaces.remove(workspaceId);
    }

    if (deletedRoot?.trim()) {
      sweepOrphanCatalogRowsAtPath(
        this.repo,
        this.workspaces,
        normalizeProjectFolderPath(deletedRoot),
      );
    }
  }
}
