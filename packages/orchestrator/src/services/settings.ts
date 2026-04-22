import { randomUUID } from 'node:crypto';
import { MemberSchema, type Organization, type Member, type Channel } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { TeamStore } from './team-store.js';
import { listProviderStatuses, validateProviderKeys, type ProviderStatus } from './team.js';

export interface TeamSettingsResponse {
  name: string;
  workspace: { root: string; roleScopes: Record<string, string[]> };
  organizationChart: { reportsTo: Record<string, string> };
  agents: unknown[];
  roles: unknown[];
  channels: unknown[];
  tools: Record<string, unknown>;
  policies: unknown;
}

export interface OrganizationSettingsResponse {
  organization: Organization;
  members: Member[];
  channels: Channel[];
}

export interface UpdateOrganizationInput {
  organizationId: string;
  organizationName?: string;
  organizationChart?: { reportsTo: Record<string, string> };
}

export interface AddMemberInput {
  organizationId: string;
  name: string;
  kind: 'human' | 'agent';
  roleName: string;
}

export interface ProviderTestResult {
  provider: string;
  ok: boolean;
  message: string;
}

function validateOrganizationChart(
  reportsTo: Record<string, string>,
  memberIds: Set<string>,
  agentIds: Set<string>,
  ownerId: string,
): void {
  for (const [childId, parentId] of Object.entries(reportsTo)) {
    if (!memberIds.has(childId)) {
      throw new Error(`Organization chart references unknown member "${childId}"`);
    }
    if (!memberIds.has(parentId)) {
      throw new Error(`Organization chart references unknown manager "${parentId}"`);
    }
    if (childId === parentId) {
      throw new Error(`Member "${childId}" cannot report to itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (memberId: string): void => {
    if (visited.has(memberId)) return;
    if (visiting.has(memberId)) {
      throw new Error(`Organization chart contains a cycle at member "${memberId}"`);
    }
    visiting.add(memberId);
    const parentId = reportsTo[memberId];
    if (parentId) walk(parentId);
    visiting.delete(memberId);
    visited.add(memberId);
  };
  for (const memberId of Object.keys(reportsTo)) walk(memberId);

  const getChainRoot = (memberId: string): string => {
    const parentId = reportsTo[memberId];
    return parentId ? getChainRoot(parentId) : memberId;
  };

  for (const agentId of agentIds) {
    const root = getChainRoot(agentId);
    if (root !== ownerId) {
      if (!reportsTo[agentId]) {
        throw new Error(
          `Agent "${agentId}" must report to the owner or a manager. Add an entry pointing to "${ownerId}".`,
        );
      }
      throw new Error(
        `Agent "${agentId}" reporting chain does not reach owner "${ownerId}". Ends at "${root}".`,
      );
    }
  }
}

export class SettingsService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly teamStore: TeamStore,
  ) {}

  getTeamSettings(): TeamSettingsResponse {
    const team = this.requireTeam();
    return {
      name: team.config.name,
      workspace: team.workspace,
      organizationChart: team.organizationChart,
      agents: team.agents,
      roles: team.roles,
      channels: team.channels,
      tools: team.tools,
      policies: team.config.policies,
    };
  }

  listProviders(organizationId: string): ProviderStatus[] {
    const team = this.requireTeam();
    this.requireOrganization(organizationId);
    return listProviderStatuses(team, this.repo.listProviderCredentials(organizationId));
  }

  upsertProviders(
    organizationId: string,
    providerKeys: Record<string, string>,
  ): ProviderStatus[] {
    const team = this.requireTeam();
    this.requireOrganization(organizationId);

    const { unknownProviders } = validateProviderKeys(team, providerKeys);
    if (unknownProviders.length > 0) {
      throw new Error(`Unknown provider keys: ${unknownProviders.join(', ')}`);
    }

    for (const [providerName, apiKey] of Object.entries(providerKeys)) {
      this.repo.saveProviderCredential(organizationId, providerName, apiKey);
    }

    return this.listProviders(organizationId);
  }

  deleteProvider(organizationId: string, providerName: string): ProviderStatus[] {
    this.requireTeam();
    this.requireOrganization(organizationId);
    this.repo.deleteProviderCredential(organizationId, providerName);
    return this.listProviders(organizationId);
  }

  testProvider(organizationId: string, providerName: string): ProviderTestResult {
    const team = this.requireTeam();
    this.requireOrganization(organizationId);

    if (!team.providers[providerName]) {
      return { provider: providerName, ok: false, message: `Unknown provider "${providerName}"` };
    }

    const key = this.repo.getProviderCredential(organizationId, providerName);
    if (!key || key.trim() === '') {
      return { provider: providerName, ok: false, message: 'No API key configured' };
    }

    return { provider: providerName, ok: true, message: 'Key present' };
  }

  listOrganizations(): Organization[] {
    return this.repo.listOrganizations();
  }

  addMember(input: AddMemberInput): Member {
    this.requireOrganization(input.organizationId);
    const member = MemberSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      kind: input.kind,
      roleName: input.roleName,
    });
    return this.repo.saveMember(member);
  }

  getOrganizationSettings(organizationId: string): OrganizationSettingsResponse {
    this.requireOrganization(organizationId);
    const organization = this.repo.getOrganization(organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${organizationId}`);
    }
    return {
      organization,
      members: this.repo.listMembers(organizationId),
      channels: this.repo.listChannels(organizationId).data,
    };
  }

  updateOrganizationSettings(input: UpdateOrganizationInput): OrganizationSettingsResponse {
    const organization = this.repo.getOrganization(input.organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${input.organizationId}`);
    }

    if (input.organizationChart) {
      const members = this.repo.listMembers(input.organizationId);
      const owner = members.find((m) => m.kind === 'human' && m.roleName === 'owner');
      if (!owner) {
        throw new Error(
          'Cannot update organization chart: no owner found. Complete onboarding first.',
        );
      }
      const memberIds = new Set(members.map((m) => m.id));
      const agentIds = new Set(members.filter((m) => m.kind === 'agent').map((m) => m.id));
      validateOrganizationChart(input.organizationChart.reportsTo, memberIds, agentIds, owner.id);
    }

    const updated = this.repo.saveOrganization({
      ...organization,
      name: input.organizationName ?? organization.name,
      organizationChart: input.organizationChart ?? organization.organizationChart,
    });

    return {
      organization: updated,
      members: this.repo.listMembers(input.organizationId),
      channels: this.repo.listChannels(input.organizationId).data,
    };
  }

  private requireTeam() {
    const team = this.teamStore.getTeam();
    if (!team) throw new Error('Team config not loaded');
    return team;
  }

  private requireOrganization(organizationId: string): void {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error(`Organization not found: ${organizationId}`);
    }
  }
}
