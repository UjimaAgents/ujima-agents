import type { ApiServiceContext } from "./context.ts";
import { listProviderStatuses, validateProviderKeys } from "./team.ts";

export class SettingsService {
  constructor(private readonly context: ApiServiceContext) {}

  getTeamSettings() {
    const team = this.requireTeam();

    return {
      name: team.config.name,
      workspace: team.workspace,
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
