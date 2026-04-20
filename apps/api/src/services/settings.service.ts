import type { ApiServiceContext } from "./context.ts";
import { listProviderStatuses, validateProviderKeys } from "./team.ts";

function validateOrganizationChart(
  reportsTo: Record<string, string>,
  memberIds: Set<string>,
  agentIds: Set<string>,
  ownerId: string,
) {
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

  const walk = (memberId: string) => {
    if (visited.has(memberId)) {
      return;
    }

    if (visiting.has(memberId)) {
      throw new Error(`Organization chart contains a cycle at member "${memberId}"`);
    }

    visiting.add(memberId);
    const parentId = reportsTo[memberId];
    if (parentId) {
      walk(parentId);
    }
    visiting.delete(memberId);
    visited.add(memberId);
  };

  for (const memberId of Object.keys(reportsTo)) {
    walk(memberId);
  }

  // Strict requirement: every agent must have a reporting chain that terminates at the owner.
  const getChainRoot = (memberId: string): string => {
    const parentId = reportsTo[memberId];
    return parentId ? getChainRoot(parentId) : memberId;
  };

  for (const agentId of agentIds) {
    const root = getChainRoot(agentId);
    if (root !== ownerId) {
      if (!reportsTo[agentId]) {
        throw new Error(
          `Agent "${agentId}" must report to the owner or a manager. Add an entry in the organization chart pointing to "${ownerId}" or an intermediate manager.`,
        );
      }
      throw new Error(
        `Agent "${agentId}" reporting chain does not reach the owner ("${ownerId}"). Its chain ends at "${root}".`,
      );
    }
  }
}


export class SettingsService {
  constructor(private readonly context: ApiServiceContext) {}

  getTeamSettings() {
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

  listProviders(organizationId: string) {
    const team = this.requireTeam();
    this.requireOrganization(organizationId);
    return listProviderStatuses(team, this.context.repo.listProviderCredentials(organizationId));
  }

  upsertProviders(organizationId: string, providerKeys: Record<string, string>) {
    const team = this.requireTeam();
    this.requireOrganization(organizationId);

    const { unknownProviders } = validateProviderKeys(team, providerKeys);
    if (unknownProviders.length > 0) {
      throw new Error(`Unknown provider keys: ${unknownProviders.join(", ")}`);
    }

    for (const [providerName, apiKey] of Object.entries(providerKeys)) {
      this.context.repo.saveProviderCredential(organizationId, providerName, apiKey);
    }

    return this.listProviders(organizationId);
  }

  getOrganizationSettings(organizationId: string) {
    this.requireOrganization(organizationId);

    const organization = this.context.repo.getOrganization(organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${organizationId}`);
    }

    return {
      organization,
      members: this.context.repo.listMembers(organizationId),
      channels: this.context.repo.listChannels(organizationId),
    };
  }

  updateOrganizationSettings(input: {
    organizationId: string;
    organizationName?: string;
    organizationChart?: { reportsTo: Record<string, string> };
  }) {
    const organization = this.context.repo.getOrganization(input.organizationId);
    if (!organization) {
      throw new Error(`Organization not found: ${input.organizationId}`);
    }

    if (input.organizationChart) {
      const members = this.context.repo.listMembers(input.organizationId);

      // The owner is the human member created during onboarding (kind=human, roleName=owner).
      const owner = members.find((m) => m.kind === "human" && m.roleName === "owner");
      if (!owner) {
        throw new Error("Cannot update organization chart: no owner found. Complete onboarding first.");
      }

      const memberIds = new Set(members.map((m) => m.id));
      const agentIds = new Set(members.filter((m) => m.kind === "agent").map((m) => m.id));

      validateOrganizationChart(input.organizationChart.reportsTo, memberIds, agentIds, owner.id);
    }

    const updated = this.context.repo.saveOrganization({
      ...organization,
      name: input.organizationName ?? organization.name,
      organizationChart: input.organizationChart ?? organization.organizationChart,
    });

    return {
      organization: updated,
      members: this.context.repo.listMembers(input.organizationId),
      channels: this.context.repo.listChannels(input.organizationId),
    };
  }

  private requireTeam() {
    if (!this.context.team) {
      throw new Error("Team config not loaded");
    }

    return this.context.team;
  }

  private requireOrganization(organizationId: string) {
    if (!this.context.repo.getOrganization(organizationId)) {
      throw new Error(`Organization not found: ${organizationId}`);
    }
  }
}
