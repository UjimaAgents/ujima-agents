import type { OnboardingRequest } from "@ujima/api-schema";
import { OWNER_MANAGER_SENTINEL, type OnboardingDraft } from "./types";

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
  zhipu: "zhipu",
  "openai-codex": "openai-codex",
};

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
}

export function normalizeProviderName(value: string) {
  const normalized = normalizeToken(value);
  return PROVIDER_NAME_MAP[normalized] ?? "openrouter";
}

export function formatProviderLabel(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
  const ownerManagerLabels = new Set([OWNER_MANAGER_SENTINEL, "owner", normalizeToken(draft.ownerName)]);
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

  const agents = roles.map((role) => ({
    kind: "agent" as const,
    name: role.name,
    roleName: role.name,
    personalityName: "direct",
  }));

  const validAgentNames = new Set(agents.map((agent) => agent.name));
  const reportsTo = Object.fromEntries(
    draft.organizationReports
      .map((report) => [report.subjectName.trim(), report.managerName.trim()] as const)
      .filter(([subjectName, managerName]) => {
        if (!validAgentNames.has(subjectName)) {
          return false;
        }

        if (!managerName || managerName === subjectName) {
          return false;
        }

        return validAgentNames.has(managerName) || ownerManagerLabels.has(normalizeToken(managerName));
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
            models: [],
          },
        ]),
      ),
      organizationChart: { reportsTo },
      policies: draft.policies,
    },
  };
}
