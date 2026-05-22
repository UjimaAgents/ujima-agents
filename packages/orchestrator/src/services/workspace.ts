import { randomUUID } from 'node:crypto';
import { createStarterAgentTeamConfig, type ProviderConfig } from '@ujima/framework';
import type { Organization } from '@ujima/shared';
import type { AuthService } from './auth.js';
import { assertWorkspaceRootPathExists } from './workspace-root.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { provisionOrganization } from './provision-organization.js';
import { orgWorkspaceId } from './workspace-org-provision.js';

export { organizationIdFromWorkspaceId } from './workspace-org-provision.js';

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

function providerConfigsFromCredentials(
  repo: ApiRepository,
  organizationId: string,
): Record<string, ProviderConfig> {
  return Object.fromEntries(
    Object.keys(repo.listProviderCredentials(organizationId)).map((providerName) => [
      providerName,
      { kind: providerName },
    ]),
  ) as Record<string, ProviderConfig>;
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

  createWorkspace(
    sessionToken: string | null | undefined,
    input: CreateWorkspaceInput,
  ): WorkspaceListItem {
    const authState = this.auth.getAuthState(sessionToken);
    if (!authState.authenticated || !authState.user || !authState.member) {
      throw new Error('session required');
    }

    const organizationName = input.organizationName.trim();
    if (!organizationName) {
      throw new Error('workspace name is required');
    }

    const workspaceRoot = assertWorkspaceRootPathExists(input.workspaceRoot);

    const templateOrganizationId = authState.user.organizationId;
    const templateOrganization = this.repo.getOrganization(templateOrganizationId);
    if (!templateOrganization) {
      throw new Error('current workspace was not found');
    }

    const teamConfig = createStarterAgentTeamConfig({
      name: organizationName,
      workspaceRoot,
      providers: providerConfigsFromCredentials(this.repo, templateOrganizationId),
    });

    const organization = provisionOrganization({
      repo: this.repo,
      teamStore: this.teamStore,
      organizationId: randomUUID(),
      name: organizationName,
      workspaceRoot,
      teamConfig,
      organizationChart: templateOrganization.organizationChart,
      owner: {
        kind: 'member',
        templateOrganizationId,
        templateMemberId: authState.member.id,
      },
      credentialSourceOrganizationId: templateOrganizationId,
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
}
