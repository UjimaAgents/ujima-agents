import type { AgentTeamHandle } from "@ujima/framework";

export function listProviderStatuses(
  team: AgentTeamHandle,
  credentials: Record<string, boolean>,
): Array<{ name: string; hasKey: boolean }> {
  const providers: Array<{ name: string; hasKey: boolean }> = [];

  for (const name of Object.keys(team.providers)) {
    providers.push({
      name,
      hasKey: Boolean(credentials[name]),
    });
  }

  return providers;
}

export function validateProviderKeys(
  team: AgentTeamHandle,
  providerKeys: Record<string, string>,
): { unknownProviders: string[]; missingProviders: string[] } {
  const unknownProviders: string[] = [];
  for (const providerName of Object.keys(providerKeys)) {
    if (!team.providers[providerName]) {
      unknownProviders.push(providerName);
    }
  }

  const missingProviders: string[] = [];
  for (const role of team.roles) {
    if (!role.provider) {
      continue;
    }

    if (!providerKeys[role.provider] && !missingProviders.includes(role.provider)) {
      missingProviders.push(role.provider);
    }
  }

  return { unknownProviders, missingProviders };
}

