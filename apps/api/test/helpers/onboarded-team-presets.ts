import type { OnboardedFixtureTeam } from './create-onboarded-fixture.js';

export const FRONTEND_CHANNELS: OnboardedFixtureTeam['channels'] = [
  { name: 'general', kind: 'general', topic: 'General' },
  { name: 'frontend', kind: 'group', topic: 'Frontend' },
];

export const FRONTEND_ENGINEER_ROLE = {
  name: 'frontend-engineer',
  title: 'Frontend Engineer',
  instructions: 'Build the frontend',
  workspaceScopes: ['apps/web'],
  tools: ['filesystem'],
  channels: ['general', 'frontend'],
} as const;

export const CHANNEL_AGENT_TOOLS = [
  'filesystem',
  'channel.post',
  'channel.read',
] as const;

export function spiritsOnboardTeam(agentNames: string[]): Record<string, unknown> {
  return {
    channels: FRONTEND_CHANNELS,
    roles: [
      {
        ...FRONTEND_ENGINEER_ROLE,
        tools: [...CHANNEL_AGENT_TOOLS],
        provider: 'local',
        model: 'mock-worker-v1',
      },
    ],
    providers: {
      local: {
        kind: 'openai',
        defaultModel: 'mock-worker-v1',
      },
    },
    agents: agentNames.map((name) => ({
      name,
      roleName: 'frontend-engineer',
      personalityName: 'direct',
    })),
  };
}
