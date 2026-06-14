import { loadAgentTeam } from '@ujima/framework';
import { OrganizationSchema, type Organization } from '@ujima/shared';
import { ConfigSyncService, persistTeamConfig } from './config-sync.js';
import {
  addMemberToDefaultChannels,
  ensureDirectMessageConversation,
  ensureMemberSelfChannel,
} from './member-channels.js';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { assertWorkspaceRootPathExists } from './workspace-root.js';
import {
  assertGrantableOwnerFromParentOrg,
  assertGrantableOwnerFromMemberOrg,
  copyProviderCredentials,
  grantOrganizationAccessForMember,
  grantWorkspaceOwnerFromParentOrg,
  WORKSPACE_OWNER_MEMBER_ID,
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
  /** When omitted, copies all provider keys from the source org (migration). When `[]`, copies none. */
  copyProviderKeys?: string[];
}

function grantOwner(
  repo: ApiRepository,
  organizationId: string,
  owner: OrganizationOwnerSource,
): void {
  if (owner.kind === 'parent') {
    grantWorkspaceOwnerFromParentOrg(
      repo,
      owner.parentOrganizationId,
      organizationId,
      WORKSPACE_OWNER_MEMBER_ID,
    );
    return;
  }
  grantOrganizationAccessForMember(
    repo,
    owner.templateOrganizationId,
    owner.templateMemberId,
    organizationId,
  );
}

export function provisionOrganization(input: ProvisionOrganizationInput): Organization {
  const resolvedRoot = assertWorkspaceRootPathExists(input.workspaceRoot);
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

  if (input.owner.kind === 'parent') {
    assertGrantableOwnerFromParentOrg(input.repo, input.owner.parentOrganizationId);
  } else {
    assertGrantableOwnerFromMemberOrg(
      input.repo,
      input.owner.templateOrganizationId,
      input.owner.templateMemberId,
    );
  }

  const organization = OrganizationSchema.parse({
    id: input.organizationId,
    name: input.name,
    workspace: {
      root: resolvedRoot,
      roleScopes: {},
    },
    organizationChart: input.organizationChart ?? team.organizationChart,
  });
  try {
    input.repo.transaction(() => {
      input.repo.saveOrganization(organization);
      grantOwner(input.repo, input.organizationId, input.owner);
      if (input.copyProviderKeys === undefined || input.copyProviderKeys.length > 0) {
        copyProviderCredentials(
          input.repo,
          input.credentialSourceOrganizationId,
          input.organizationId,
          input.copyProviderKeys,
        );
      }

      persistTeamConfig(input.repo, input.organizationId, team);
      new ConfigSyncService(input.repo, input.teamStore).reconcileTeamConfig({
        team,
        organizationId: input.organizationId,
      });

      const owner = input.repo.getMember(input.organizationId, WORKSPACE_OWNER_MEMBER_ID);
      if (owner) {
        ensureMemberSelfChannel(input.repo, input.organizationId, owner);
        addMemberToDefaultChannels(input.repo, team, input.organizationId, owner);
        const starterAgent = team.agents[0]
          ? input.repo.getMember(input.organizationId, team.agents[0].name)
          : null;
        if (starterAgent) {
          ensureDirectMessageConversation(
            input.repo,
            input.organizationId,
            owner,
            starterAgent,
          );
        }
      }

      input.repo.saveOrganization(organization);
    });
  } catch (error) {
    input.teamStore.clearTeam(input.organizationId);
    throw error;
  }

  return organization;
}
