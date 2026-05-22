import { randomUUID } from 'node:crypto';
import { loadAgentTeam } from '@ujima/framework';
import { OrganizationSchema, type Organization } from '@ujima/shared';
import { ConfigSyncService, persistTeamConfig } from './config-sync.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { assertWorkspaceRootPathExists } from './workspace-root.js';
import {
  assertGrantableOwnerFromParentOrg,
  copyProviderCredentials,
  grantWorkspaceOwnerForMember,
  grantWorkspaceOwnerFromParentOrg,
} from './workspace-org-provision.js';

export type OrganizationOwnerSource =
  | { kind: 'parent'; parentOrganizationId: string }
  | { kind: 'member'; templateOrganizationId: string; templateMemberId: string };

export interface ProvisionOrganizationInput {
  repo: ApiRepository;
  teamStore: TeamStore;
  organizationId: string;
  name: string;
  workspaceRoot: string;
  teamConfig: Record<string, unknown>;
  organizationChart?: Organization['organizationChart'];
  owner: OrganizationOwnerSource;
  credentialSourceOrganizationId: string;
}

function assertOwnerCanBeProvisioned(repo: ApiRepository, owner: OrganizationOwnerSource): void {
  if (owner.kind === 'parent') {
    assertGrantableOwnerFromParentOrg(repo, owner.parentOrganizationId);
    return;
  }

  const authUser = repo.getAuthUserByMember(owner.templateOrganizationId, owner.templateMemberId);
  if (!authUser) {
    throw new Error('current user has no credentials for this workspace');
  }
  const stored = repo.getAuthUserCredentials(
    owner.templateOrganizationId,
    authUser.email.trim().toLowerCase(),
  );
  if (!stored) {
    throw new Error('current user credentials were not found');
  }
  const templateMember = repo.getMember(owner.templateOrganizationId, owner.templateMemberId);
  if (!templateMember || templateMember.kind !== 'human') {
    throw new Error('only human members can own a workspace');
  }
}

function grantOwner(
  repo: ApiRepository,
  organizationId: string,
  owner: OrganizationOwnerSource,
): void {
  const ownerMemberId = randomUUID();
  if (owner.kind === 'parent') {
    grantWorkspaceOwnerFromParentOrg(
      repo,
      owner.parentOrganizationId,
      organizationId,
      ownerMemberId,
    );
    return;
  }
  grantWorkspaceOwnerForMember(
    repo,
    owner.templateOrganizationId,
    owner.templateMemberId,
    organizationId,
  );
}

/**
 * Creates an organization with a login-capable owner before team reconcile runs.
 * Owner and credentials are written immediately after the org row so a failed
 * reconcile does not leave an inaccessible workspace.
 */
export function provisionOrganization(input: ProvisionOrganizationInput): Organization {
  const resolvedRoot = assertWorkspaceRootPathExists(input.workspaceRoot);
  assertOwnerCanBeProvisioned(input.repo, input.owner);

  const organization = OrganizationSchema.parse({
    id: input.organizationId,
    name: input.name,
    workspace: {
      root: resolvedRoot,
      roleScopes: {},
    },
    organizationChart: input.organizationChart ?? { reportsTo: {} },
  });
  input.repo.saveOrganization(organization);
  grantOwner(input.repo, input.organizationId, input.owner);
  copyProviderCredentials(
    input.repo,
    input.credentialSourceOrganizationId,
    input.organizationId,
  );

  const team = loadAgentTeam({
    ...input.teamConfig,
    name: input.name,
    workspace: {
      ...(typeof input.teamConfig.workspace === 'object' && input.teamConfig.workspace
        ? input.teamConfig.workspace
        : {}),
      root: resolvedRoot,
    },
  });
  persistTeamConfig(input.repo, input.organizationId, team);
  const configSync = new ConfigSyncService(input.repo, input.teamStore);
  configSync.reconcileTeamConfig({
    team,
    organizationId: input.organizationId,
  });

  return organization;
}
