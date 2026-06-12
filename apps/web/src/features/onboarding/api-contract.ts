import type { OnboardingRequest } from "@ujima/api-schema";
import { normalizeProviderKey, normalizeProviderToken } from "@/features/providers/catalog";
import {
  OWNER_MANAGER_SENTINEL,
  type OnboardingDraft,
  type TeamProviderDraft,
} from "./types";

export const MIN_TEAM_AGENTS = 2;

const PROVIDER_NAME_MAP: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  openrouter: "openrouter",
  ollama: "ollama",
  deepseek: "deepseek",
  xai: "xai",
  mistral: "mistral",
  kimi: "kimi",
  "zhipu": "zhipu",
  "zhipu-ai": "zhipu",
  "openai-codex": "openai-codex",
};

export function normalizeProviderName(value: string) {
  const normalized = normalizeProviderKey(value);
  return PROVIDER_NAME_MAP[normalized] ?? "openrouter";
}

export function isProviderDraftComplete(provider: TeamProviderDraft): boolean {
  const name = provider.name.trim();
  return Boolean(name && (normalizeProviderName(name) === "ollama" || provider.apiKey.trim()));
}

function toRoleTitle(name: string) {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildOnboardingRequest(draft: OnboardingDraft): OnboardingRequest {
  const channelsById = new Map(draft.channels.map((channel) => [channel.id, channel]));
  const ownerManagerLabels = new Set([OWNER_MANAGER_SENTINEL, "owner", normalizeProviderToken(draft.ownerName)]);
  const agentNameByRoleName = new Map(
    draft.roles.map((role) => [role.name.trim(), role.agentName.trim() || role.name.trim()] as const),
  );
  const validAgentNames = new Set(draft.roles.map((role) => role.agentName.trim() || role.name.trim()));
  const providerEntries = draft.providers
    .map((provider) => {
      const name = normalizeProviderName(provider.name);
      return {
        name,
        apiKey: provider.apiKey.trim(),
      };
    })
    .filter((provider) => provider.name.length > 0);

  const roles = draft.roles.map((role) => {
    const roleName = role.name.trim();
    const channels = role.channelIds
      .map((channelId) => channelsById.get(channelId)?.name.trim())
      .filter((channelName): channelName is string => Boolean(channelName));

    return {
      kind: "agent" as const,
      name: roleName,
      title: role.title.trim() || toRoleTitle(roleName),
      description: role.title.trim() || toRoleTitle(roleName),
      instructions: role.instructions.trim() || `Operate as the ${toRoleTitle(roleName)} role.`,
      provider: normalizeProviderName(role.llm),
      model: role.model.trim() || undefined,
      workspaceScopes: [],
      tools: [],
      channels,
      skills: [],
    };
  });

  const agents = draft.roles.map((role) => ({
    kind: "agent" as const,
    name: role.agentName.trim() || role.name,
    roleName: role.name.trim(),
    personalityName: "direct",
  }));

  const resolveAgentName = (value: string) => {
    const normalized = value.trim();
    return validAgentNames.has(normalized) ? normalized : agentNameByRoleName.get(normalized) ?? normalized;
  };
  const reportsTo = Object.fromEntries(
    draft.organizationReports
      .map((report) => [resolveAgentName(report.subjectName), resolveAgentName(report.managerName)] as const)
      .filter(([subjectName, managerName]) => {
        if (!validAgentNames.has(subjectName)) {
          return false;
        }

        if (!managerName || managerName === subjectName) {
          return false;
        }

        return validAgentNames.has(managerName) || ownerManagerLabels.has(normalizeProviderToken(managerName));
      }),
  );

  return {
    organizationName: draft.organizationName.trim(),
    ownerName: draft.ownerName.trim(),
    ownerEmail: draft.ownerEmail.trim(),
    ownerPassword: draft.ownerPassword,
    workspaceRoot: draft.workspaceRoot.trim(),
    providerKeys: Object.fromEntries(
      providerEntries
        .filter((provider) => provider.apiKey.length > 0)
        .map((provider) => [provider.name, provider.apiKey]),
    ),
    team: {
      name: draft.organizationName.trim(),
      roles,
      agents,
      channels: draft.channels.map((channel) => ({
        id: channel.id,
        name: channel.name.trim(),
        kind: "general",
        topic: channel.description.trim(),
        memberIds: [],
      })),
      providers: Object.fromEntries(
        providerEntries.map((provider) => [
          provider.name,
          {
            kind: provider.name,
            models: [],
          },
        ]),
      ),
      organizationChart: { reportsTo },
      policies: draft.policies,
    },
  };
}
