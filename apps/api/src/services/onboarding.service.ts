import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ChannelSchema, MemberSchema, OrganizationSchema } from "@ujima/shared";
import { loadTeam, summarizeTeam } from "../config.ts";
import type { Repository } from "../repositories.ts";
import { validateProviderKeys } from "./team.ts";

function roleMemberId(roleId: string | undefined, roleName: string) {
  return roleId ?? roleName;
}

function channelId(channel: { id?: string; name: string }) {
  return channel.id ?? channel.name;
}

function buildInitialOrganizationChart(ownerId: string, roleMemberIds: Map<string, string>): { reportsTo: Record<string, string> } {
  const reportsTo: Record<string, string> = {};

  for (const [roleName, memberId] of roleMemberIds) {
    if (roleName === "engineering-manager" || roleName === "pm") {
      reportsTo[memberId] = ownerId;
      continue;
    }

    if (roleName === "frontend-engineer" || roleName === "backend-engineer" || roleName === "qa-engineer") {
      reportsTo[memberId] = roleMemberIds.get("engineering-manager") ?? ownerId;
      continue;
    }

    if (roleName === "code-reviewer") {
      reportsTo[memberId] = roleMemberIds.get("engineering-manager") ?? ownerId;
    }
  }

  return { reportsTo };
}

export class OnboardingService {
  constructor(private readonly repo: Repository) {}

  async onboard(input: {
    organizationName: string;
    ownerName: string;
    workspaceRoot: string;
    providerKeys: Record<string, string>;
    configFilePath?: string;
  }) {
    const team = await loadTeam(input.configFilePath);

    if (resolve(input.workspaceRoot) !== team.workspace.root) {
      throw new Error("Workspace root must match the team config");
    }

    const { unknownProviders, missingProviders } = validateProviderKeys(team, input.providerKeys);
    if (unknownProviders.length > 0) {
      throw new Error(`Unknown provider keys: ${unknownProviders.join(", ")}`);
    }

    if (missingProviders.length > 0) {
      throw new Error(`Missing provider keys: ${missingProviders.join(", ")}`);
    }

    const ownerId = randomUUID();
    const organizationId = randomUUID();
    const memberIdByRole = new Map(team.roles.map((role) => [role.name, roleMemberId(role.id, role.name)]));
    const organizationChart = buildInitialOrganizationChart(ownerId, memberIdByRole);

    const organization = OrganizationSchema.parse({
      id: organizationId,
      name: input.organizationName,
      workspace: team.workspace,
      organizationChart,
    });

    this.repo.saveOrganization(organization);
    const owner = MemberSchema.parse({
      id: ownerId,
      organizationId,
      name: input.ownerName,
      kind: "human",
      roleName: "owner",
      presence: "offline",
      createdAt: new Date().toISOString(),
    });

    for (const [providerName, apiKey] of Object.entries(input.providerKeys)) {
      this.repo.saveProviderCredential(organizationId, providerName, apiKey);
    }

    const members = [
      owner,
      ...team.roles.map((role) =>
      MemberSchema.parse({
        id: roleMemberId(role.id, role.name),
        organizationId,
        name: role.title,
        kind: role.kind,
        roleName: role.name,
        presence: "offline",
        createdAt: new Date().toISOString(),
      })),
    ];

    for (const member of members) {
      this.repo.saveMember(member);
    }

    const channels = team.channels.map((config) =>
      ChannelSchema.parse({
        id: channelId(config),
        organizationId,
        name: config.name,
        kind: config.kind,
        topic: config.topic,
        memberIds: config.memberIds ?? [],
      }),
    );

    for (const channel of channels) {
      this.repo.saveChannel(channel);
    }

    const channelsByName = new Map(channels.map((channel) => [channel.name, channel]));
    const memberIdsByRole = new Map(members.map((member) => [member.roleName, member.id]));
    const channelMemberships = new Map<string, Set<string>>(
      channels.map((channel) => [channel.id, new Set(channel.memberIds)]),
    );

    for (const role of team.roles) {
      const memberId = memberIdsByRole.get(role.name);
      if (!memberId) {
        continue;
      }

      for (const channelName of role.channels) {
        const channel = channelsByName.get(channelName);
        if (!channel) {
          continue;
        }

        channelMemberships.get(channel.id)?.add(memberId);
      }
    }

    for (const [channelId, memberIds] of channelMemberships) {
      this.repo.setChannelMembers(channelId, [...memberIds]);
    }

    this.repo.saveOrganization(organization);

    return {
      organization,
      members,
      channels: this.repo.listChannels(organizationId),
      team: summarizeTeam(team),
    };
  }
}
