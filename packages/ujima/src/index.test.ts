import path from 'node:path';
import { expect, test } from 'vitest';
import {
  AgentTeam,
  createAgent,
  createOrganizationChart,
  createPersonalityFromPreset,
  ROLE_PRESETS,
  createRoleFromPreset,
  createStarterAgentTeamConfig,
  defineProvider,
  defineTool,
  loadAgentTeam,
  listRolePresets,
  validateAgentTeamConfig,
} from './index.js';

test('starter config includes the preset team shape', () => {
  const config = createStarterAgentTeamConfig({
    name: 'Ujima Demo',
    workspaceRoot: '/tmp/ujima-org',
    organizationChart: {
      reportsTo: {
        'frontend-engineer': 'pm',
      },
    },
  });

  expect(config.name).toBe('Ujima Demo');
  expect(config.channels[0]?.name).toBe('general');
  expect(Object.keys(config.tools)).toContain('view');
  expect(Object.keys(config.tools)).toContain('write');
  expect(Object.keys(config.tools)).toContain('grep');
  expect(Object.keys(config.tools)).toContain('shell');
  expect(config.agents.map((agent) => agent.name)).toContain('pm');
  expect(config.organizationChart.reportsTo['frontend-engineer']).toBe('pm');
  expect(config.roles.map((role) => role.name)).toContain('frontend-engineer');
  expect(config.roles.map((role) => role.name)).not.toContain('engineering-frontend-developer');
  expect(config.workspace.root).toBe(path.resolve('/tmp/ujima-org'));
  expect(config.workspace.roleScopes['frontend-engineer']?.[0]).toBe(
    path.resolve('/tmp/ujima-org/apps/web'),
  );
});

test('role catalog mirrors the upstream industry folders', () => {
  const names = listRolePresets().map((role) => role.name);

  expect(names).toContain('engineering-frontend-developer');
  expect(names).toContain('product-manager');
  expect(names).toContain('support-support-responder');
});

test('framework helpers normalize roles, tools, and providers', () => {
  const provider = defineProvider({
    kind: 'openai',
    defaultModel: 'gpt-5.4',
    models: ['gpt-5.4'],
  });
  const tool = defineTool({
    id: 'write',
    name: 'Write',
    actions: ['write'],
    pathScopes: ['.'],
    requiresApproval: true,
  });
  const role = createRoleFromPreset('frontendEngineer', {
    provider: 'openai',
    model: 'gpt-5.4',
  });

  expect(provider.defaultModel).toBe('gpt-5.4');
  expect(tool.id).toBe('write');
  expect(role.name).toBe('frontend-engineer');
  expect(createPersonalityFromPreset('direct').name).toBe('direct');
});

test('createOrganizationChart validates agent references', () => {
  const chart = createOrganizationChart(
    {
      'frontend-alice': 'pm',
    },
    [
      createAgent('pm', 'pm', 'direct'),
      createAgent('frontend-alice', 'frontend-engineer', 'thoughtful'),
    ],
  );

  expect(chart.reportsTo['frontend-alice']).toBe('pm');
});

test('AgentTeam normalizes and validates the team config', () => {
  const team = AgentTeam({
    name: 'Ujima Demo',
    workspace: {
      root: '/tmp/ujima-org',
      roleScopes: {
        'frontend-engineer': ['apps/web'],
      },
    },
    organizationChart: {
      reportsTo: {
        'frontend-alice': 'pm',
        'frontend-bob': 'pm',
      },
    },
    agents: [
      createAgent('pm', 'pm', 'direct'),
      createAgent('frontend-alice', 'frontend-engineer', 'thoughtful'),
      createAgent('frontend-bob', 'frontend-engineer', 'skeptical'),
    ],
    providers: {
      openai: {
        kind: 'openai',
        defaultModel: 'gpt-5.4',
        models: ['gpt-5.4'],
      },
    },
    roles: [
      {
        name: 'pm',
        title: 'Product Manager',
        instructions: ROLE_PRESETS.pm?.instructions ?? '',
        workspaceScopes: ['.'],
        tools: ['filesystem'],
        channels: ['general'],
      },
      {
        name: 'frontend-engineer',
        title: 'Frontend Engineer',
        instructions: ROLE_PRESETS.frontendEngineer?.instructions ?? '',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['apps/web'],
        tools: ['filesystem', 'shell'],
        channels: ['general'],
      },
    ],
  });

  expect(team.kind).toBe('ujima.agent-team');
  expect(team.organizationChart.reportsTo['frontend-alice']).toBe('pm');
  expect(team.getAgent('frontend-bob')?.personalityName).toBe('skeptical');
  expect(team.getRole('frontend-engineer')?.workspaceScopes[0]).toBe(
    path.resolve('/tmp/ujima-org/apps/web'),
  );
  expect(team.getProvider('openai')?.defaultModel).toBe('gpt-5.4');
  expect(team.getChannel('general')?.kind).toBe('general');
});

test('AgentTeam normalizes provider keys before lookup', () => {
  const team = AgentTeam({
    name: 'Ujima Demo',
    workspace: {
      root: '/tmp/ujima-org',
      roleScopes: {},
    },
    organizationChart: { reportsTo: {} },
    agents: [createAgent('pm', 'pm', 'direct')],
    providers: {
      OpenAI: {
        kind: 'openai',
        defaultModel: 'gpt-5.4',
        models: ['gpt-5.4'],
      },
    },
    roles: [
      {
        name: 'pm',
        title: 'Product Manager',
        instructions: ROLE_PRESETS.pm?.instructions ?? '',
        provider: 'OpenAI',
        workspaceScopes: ['.'],
        tools: ['filesystem'],
        channels: ['general'],
      },
    ],
  });

  expect(team.getProvider('openai')?.defaultModel).toBe('gpt-5.4');
  expect(team.getRole('pm')?.provider).toBe('openai');
});

test('loadAgentTeam returns a ready-to-use handle', () => {
  const team = loadAgentTeam({
    name: 'Ujima Demo',
    workspace: {
      root: '/tmp/ujima-org',
      roleScopes: {
        'frontend-engineer': ['apps/web'],
      },
    },
    organizationChart: {
      reportsTo: {
        'frontend-alice': 'pm',
      },
    },
    agents: [
      createAgent('pm', 'pm', 'direct'),
      createAgent('frontend-alice', 'frontend-engineer', 'precise'),
    ],
    providers: {
      openai: {
        kind: 'openai',
        defaultModel: 'gpt-5.4',
        models: ['gpt-5.4'],
      },
    },
    roles: [
      {
        name: 'pm',
        title: 'Product Manager',
        instructions: ROLE_PRESETS.pm?.instructions ?? '',
        workspaceScopes: ['.'],
        tools: ['filesystem'],
        channels: ['general'],
      },
      {
        name: 'frontend-engineer',
        title: 'Frontend Engineer',
        instructions: ROLE_PRESETS.frontendEngineer?.instructions ?? '',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['apps/web'],
        tools: ['filesystem', 'shell'],
        channels: ['general'],
      },
    ],
  });

  expect(team.getRole('frontend-engineer')?.name).toBe('frontend-engineer');
  expect(team.getAgent('frontend-alice')?.roleName).toBe('frontend-engineer');
});

test('legacy default role tools are migrated forward on load', () => {
  const team = loadAgentTeam({
    name: 'Ujima Demo',
    workspace: {
      root: '/tmp/ujima-org',
      roleScopes: {},
    },
    organizationChart: { reportsTo: {} },
    agents: [createAgent('pm', 'pm', 'direct')],
    roles: [
      {
        name: 'pm',
        title: 'Product Manager',
        instructions: ROLE_PRESETS.pm?.instructions ?? '',
        workspaceScopes: ['.'],
        tools: ['filesystem'],
        channels: ['general'],
      },
      {
        name: 'frontend-engineer',
        title: 'Frontend Engineer',
        instructions: ROLE_PRESETS.frontendEngineer?.instructions ?? '',
        workspaceScopes: ['apps/web'],
        tools: ['filesystem', 'shell', 'message', 'channel.post', 'channel.reply', 'channel.dm', 'channel.list', 'channel.read', 'self.note', 'mcp'],
        channels: ['general'],
      },
    ],
  });

  expect(team.config.configVersion).toBe(4);
  expect(team.getRole('frontend-engineer')?.tools).toContain('grep');
  expect(team.getRole('frontend-engineer')?.tools).not.toContain('self.note');
});

test('filesystem is stripped from persisted role tools on load', () => {
  const team = loadAgentTeam({
    name: 'Ujima Demo',
    workspace: {
      root: '/tmp/ujima-org',
      roleScopes: {},
    },
    organizationChart: { reportsTo: {} },
    agents: [createAgent('pm', 'frontend-engineer', 'direct')],
    roles: [
      {
        name: 'pm',
        title: 'Product Manager',
        instructions: ROLE_PRESETS.pm?.instructions ?? '',
        workspaceScopes: ['.'],
        tools: ['filesystem'],
        channels: ['general'],
      },
      {
        name: 'frontend-engineer',
        title: 'Frontend Engineer',
        instructions: ROLE_PRESETS.frontendEngineer?.instructions ?? '',
        workspaceScopes: ['apps/web'],
        tools: ['filesystem', 'view', 'write', 'edit', 'shell'],
        channels: ['general'],
      },
    ],
  });

  expect(team.getRole('frontend-engineer')?.tools).not.toContain('filesystem');
  expect(team.getRole('frontend-engineer')?.tools).toContain('view');
  expect(team.config.configVersion).toBe(4);
});

test('validateAgentTeamConfig rejects agents that reference unknown roles', () => {
  expect(() =>
    validateAgentTeamConfig({
      name: 'Broken Team',
      workspace: { root: '/tmp/ujima-org', roleScopes: {} },
      roles: [
        {
          name: 'pm',
          title: 'Product Manager',
          instructions: ROLE_PRESETS.pm?.instructions ?? '',
          workspaceScopes: ['.'],
          tools: ['filesystem'],
          channels: ['general'],
        },
      ],
      agents: [createAgent('frontend-alice', 'frontend-engineer', 'direct')],
    }),
  ).toThrow(/unknown role/i);
});
