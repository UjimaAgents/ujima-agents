import path from 'node:path';
import { expect, test } from 'vitest';
import {
  AgentTeam,
  createAgent,
  createOrganizationChart,
  createPersonalityFromPreset,
  ROLE_PRESETS,
  createRoleFromPreset,
  createEmptyWorkspaceTeamConfig,
  defineProvider,
  defineTool,
  migrateAgentTeamConfig,
} from './index.js';

test('empty workspace config has roles but no agents', () => {
  const config = createEmptyWorkspaceTeamConfig({
    name: 'Empty Workspace',
    workspaceRoot: '/tmp/empty-ws',
  });

  expect(config.agents).toEqual([]);
  expect(config.organizationChart.reportsTo).toEqual({});
  expect(config.roles).toHaveLength(1);
  expect(config.roles[0]?.name).toBe('agent');
  expect(config.roles[0]?.workspaceScopes).toEqual([path.resolve('/tmp/empty-ws')]);
  expect(config.workspace.roleScopes).toEqual({});
  expect(config.channels[0]?.name).toBe('general');
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

test('team config migration preserves existing providers and role tools', () => {
  const result = migrateAgentTeamConfig({
    configVersion: 5,
    name: 'Existing Org',
    workspace: { root: '/tmp/existing-org', roleScopes: {} },
    organizationChart: { reportsTo: {} },
    providers: {
      deepseek: { kind: 'deepseek', defaultModel: 'deepseek-v4-flash', models: [] },
      google: { kind: 'google', defaultModel: 'gemini-2.5-pro', models: [] },
    },
    tools: {
      'channel.read': { id: 'channel.read' },
      filesystem: { id: 'filesystem' },
      'memory.save': { id: 'memory.save' },
    },
    roles: [
      {
        name: 'engineering-manager',
        title: 'Engineering Manager',
        instructions: 'Ship.',
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        workspaceScopes: ['.'],
        tools: ['channel.read', 'filesystem', 'memory.save'],
        channels: ['general'],
      },
    ],
    agents: [],
    channels: [{ name: 'general', kind: 'general' }],
  });

  expect(Object.keys(result.config.providers as Record<string, unknown>).sort()).toEqual([
    'deepseek',
    'google',
  ]);
  expect((result.config.roles as Array<{ tools: string[] }>)[0]?.tools).toEqual([
    'channel.read',
    'memory.write',
    'skill.read',
  ]);
});
