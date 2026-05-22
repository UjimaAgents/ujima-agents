import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@ujima/context-store';
import { OnboardingService, createTeamStore } from '@ujima/orchestrator';
import { Repository } from '@ujima/runtime-core';
import { FRONTEND_CHANNELS, FRONTEND_ENGINEER_ROLE } from './onboarded-team-presets.js';

export interface OnboardedFixtureTeam {
  channels?: Array<{ name: string; kind: string; topic: string }>;
  roles?: Array<{
    name: string;
    title: string;
    instructions: string;
    workspaceScopes: string[];
    tools: string[];
    channels: string[];
    provider?: string;
    model?: string;
  }>;
  agents?: Array<{ name: string; roleName: string; personalityName: string }>;
  providers?: Record<string, unknown>;
}

export interface CreateOnboardedFixtureOptions {
  organizationName?: string;
  archiveRoot?: string;
  agentNames?: string[];
  providerKeys?: Record<string, string>;
  team?: OnboardedFixtureTeam;
}

const DEFAULT_TEAM: Required<OnboardedFixtureTeam> = {
  channels: [...FRONTEND_CHANNELS!],
  roles: [{ ...FRONTEND_ENGINEER_ROLE }],
  agents: [],
};

export async function createOnboardedFixture(options: CreateOnboardedFixtureOptions = {}) {
  const archiveRoot = options.archiveRoot ?? (await mkdtemp(join(tmpdir(), 'ujima-api-fixture-')));
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const teamStore = createTeamStore();
  const onboarding = new OnboardingService(repo, teamStore);
  const organizationName = options.organizationName ?? 'Test Org';
  const agentNames = options.agentNames ?? [];
  const team = {
    ...DEFAULT_TEAM,
    ...options.team,
    channels: options.team?.channels ?? DEFAULT_TEAM.channels,
    roles: options.team?.roles ?? DEFAULT_TEAM.roles,
    agents:
      options.team?.agents ??
      agentNames.map((name) => ({
        name,
        roleName: 'frontend-engineer',
        personalityName: 'direct',
      })),
  };

  const result = await onboarding.onboard({
    organizationName,
    ownerName: 'Owner',
    workspaceRoot: archiveRoot,
    providerKeys: options.providerKeys ?? {},
    team: {
      name: organizationName,
      ...team,
    },
  });

  const owner = result.members.find((member) => member.kind === 'human');
  if (!owner) {
    throw new Error('owner missing from onboarding result');
  }

  return {
    archiveRoot,
    repo,
    teamStore,
    onboarding,
    organizationId: result.organization.id,
    ownerId: owner.id,
    result,
  };
}
