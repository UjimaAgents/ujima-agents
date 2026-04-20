import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ChannelSchema, MemberSchema, OrganizationSchema } from "@ujima/shared";
import { loadAgentTeam, loadAgentTeamFromFile, type AgentTeamHandle } from "@ujima/framework";
import { loadTeam, summarizeTeam } from "../config.ts";
import type { Repository } from "../repositories.ts";
import { validateProviderKeys } from "./team.ts";

function channelId(channel: { id?: string; name: string }) {
  return channel.id ?? channel.name;
}

function buildInitialOrganizationChart(ownerId: string, agents: Array<{ name: string; roleName: string }>): { reportsTo: Record<string, string> } {
  const reportsTo: Record<string, string> = {};
  const byRole = new Map<string, string[]>();

  for (const agent of agents) {
    const current = byRole.get(agent.roleName) ?? [];
    current.push(agent.name);
    byRole.set(agent.roleName, current);
  }

  const engineeringManagerId = byRole.get("engineering-manager")?.[0] ?? ownerId;

  for (const agent of agents) {
    if (agent.roleName === "engineering-manager" || agent.roleName === "pm") {
      reportsTo[agent.name] = ownerId;
      continue;
    }

    if (agent.roleName === "frontend-engineer" || agent.roleName === "backend-engineer" || agent.roleName === "qa-engineer") {
      reportsTo[agent.name] = engineeringManagerId;
      continue;
    }

    if (agent.roleName === "code-reviewer") {
      reportsTo[agent.name] = engineeringManagerId;
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
    team?: {
      name?: string;
      agents?: unknown[];
      roles?: unknown[];
      channels?: unknown[];
      providers?: Record<string, unknown>;
      organizationChart?: { reportsTo: Record<string, string> };
      policies?: unknown;
    };
  }) {
    let team: AgentTeamHandle;

    if (input.team) {
      // Inline team config provided — build directly from the request body.
      team = loadAgentTeam({
        name: input.team.name ?? input.organizationName,
        workspace: { root: resolve(input.workspaceRoot) },
        agents: input.team.agents ?? [],
        roles: input.team.roles ?? [],
        channels: input.team.channels ?? [],
        providers: input.team.providers ?? {},
        organizationChart: input.team.organizationChart ?? { reportsTo: {} },
        policies: input.team.policies,
      } as Record<string, unknown>);
    } else {
      // Fall back to file-based config.
      team = await loadTeam(input.configFilePath);

      if (resolve(input.workspaceRoot) !== team.workspace.root) {
        throw new Error("Workspace root must match the team config");
      }
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
    const organizationChart =
      Object.keys(team.organizationChart.reportsTo).length > 0
        ? team.organizationChart
        : buildInitialOrganizationChart(ownerId, team.agents);

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
      ...team.agents.map((agent) =>
      MemberSchema.parse({
        id: agent.name,
        organizationId,
        name: agent.name,
        kind: "agent",
        roleName: agent.roleName,
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
    const memberIdsByRole = new Map<string, string[]>();
    const channelMemberships = new Map<string, Set<string>>(
      channels.map((channel) => [channel.id, new Set(channel.memberIds)]),
    );

    for (const member of members) {
      if (member.kind !== "agent") {
        continue;
      }

      const memberIds = memberIdsByRole.get(member.roleName) ?? [];
      memberIds.push(member.id);
      memberIdsByRole.set(member.roleName, memberIds);
    }

    for (const agent of team.agents) {
      const memberIds = memberIdsByRole.get(agent.roleName) ?? [];

      for (const channelName of team.getRole(agent.roleName)?.channels ?? []) {
        const channel = channelsByName.get(channelName);
        if (!channel) {
          continue;
        }

        for (const memberId of memberIds) {
          channelMemberships.get(channel.id)?.add(memberId);
        }
      }
    }

    for (const [channelId, memberIds] of channelMemberships) {
      this.repo.setChannelMembers(channelId, [...memberIds]);
    }

    return {
      organization,
      members,
      channels: this.repo.listChannels(organizationId),
      team: summarizeTeam(team),
    };
  }
}
