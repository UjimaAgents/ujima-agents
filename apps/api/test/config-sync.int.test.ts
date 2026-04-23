import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import { OrganizationSchema } from '@ujima/shared';
import {
  ConfigSyncService,
  SettingsService,
  createTeamStore,
} from '@ujima/orchestrator';

function teamConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Config Owned Org',
    workspace: {
      root: '/tmp/ujima-workspace',
      roleScopes: {},
    },
    organizationChart: {
      reportsTo: {
        'frontend-alice': 'pm',
      },
    },
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
        instructions: 'Lead the work.',
        workspaceScopes: ['.'],
        tools: ['filesystem'],
        channels: ['general', 'triage'],
      },
      {
        name: 'frontend-engineer',
        title: 'Frontend Engineer',
        instructions: 'Build the product.',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['apps/web'],
        tools: ['filesystem', 'shell'],
        channels: ['general'],
      },
    ],
    agents: [
      {
        name: 'pm',
        roleName: 'pm',
        personalityName: 'direct',
      },
      {
        name: 'frontend-alice',
        roleName: 'frontend-engineer',
        personalityName: 'direct',
      },
    ],
    channels: [
      {
        name: 'general',
        kind: 'general',
        topic: 'General coordination',
      },
      {
        name: 'triage',
        kind: 'group',
        topic: 'Bug triage',
      },
    ],
    ...overrides,
  };
}

async function writeConfigFile(path: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(path, `export default ${JSON.stringify(config, null, 2)};\n`, 'utf8');
}

function makeChannels(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `channel-${String(index + 1).padStart(2, '0')}`,
    kind: 'group',
    topic: `Channel ${index + 1}`,
  }));
}

describe('team config reconcile', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('reconciles config changes, retires dropped agents, and archives dropped channels', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig());
    const first = await syncService.loadAndReconcileFromFile(configPath);
    repo.saveProviderCredential(first.organization.id, 'openai', 'sk-openai');

    expect(first.organization.name).toBe('Config Owned Org');
    expect(first.members.map((member) => member.id).sort()).toEqual(['frontend-alice', 'pm']);
    expect(first.channels.map((channel) => channel.id).sort()).toEqual(['general', 'triage']);
    expect(teamStore.getTeam()?.config.name).toBe('Config Owned Org');
    expect(
      repo.getConfigFieldOwnership(first.organization.id, 'organization', first.organization.id, 'name')
        ?.owner,
    ).toBe('config');

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    await writeConfigFile(
      configPath,
      teamConfig({
        name: 'Config Owned Org v2',
        organizationChart: { reportsTo: {} },
        providers: {},
        roles: [
          {
            name: 'pm',
            title: 'Product Manager',
            instructions: 'Lead the work.',
            workspaceScopes: ['.'],
            tools: ['filesystem'],
            channels: ['general'],
          },
        ],
        agents: [
          {
            name: 'pm',
            roleName: 'pm',
            personalityName: 'direct',
          },
        ],
        channels: [
          {
            name: 'general',
            kind: 'general',
            topic: 'General coordination v2',
          },
        ],
      }),
    );

    const second = await syncService.loadAndReconcileFromFile(configPath, first.organization.id);
    const frontendAlice = repo.getMember(first.organization.id, 'frontend-alice');
    const triage = repo.getChannel(first.organization.id, 'triage');
    const general = repo.getChannel(first.organization.id, 'general');

    expect(second.organization.name).toBe('Config Owned Org v2');
    expect(teamStore.getTeam()?.config.name).toBe('Config Owned Org v2');
    expect(frontendAlice?.retiredAt).toBeTruthy();
    expect(triage?.archivedAt).toBeTruthy();
    expect(general?.archivedAt).toBeUndefined();
    expect(general?.topic).toBe('General coordination v2');
    expect(repo.getProviderCredential(first.organization.id, 'openai')).toBeNull();
    expect(second.stats.membersRetired).toBe(1);
    expect(second.stats.channelsArchived).toBe(1);
    expect(second.stats.providersRetired).toBe(1);
  });

  it('rejects dashboard-style organization edits when the field is config owned', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const settings = new SettingsService(repo, teamStore);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig());
    const result = await syncService.loadAndReconcileFromFile(configPath);

    expect(() =>
      settings.updateOrganizationSettings({
        organizationId: result.organization.id,
        organizationName: 'Manual Rename',
      }),
    ).toThrow(/managed by config/i);
  });

  it('reconciles a config file back into its bound organization instead of the latest org', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig({ name: 'Bound Org' }));
    const first = await syncService.loadAndReconcileFromFile(configPath);

    const other = repo.saveOrganization(
      OrganizationSchema.parse({
        id: 'other-org',
        name: 'Other Org',
        workspace: { root: '/tmp/other-org', roleScopes: {} },
        organizationChart: { reportsTo: {} },
      }),
    );

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    await writeConfigFile(configPath, teamConfig({ name: 'Bound Org Updated' }));
    const second = await syncService.loadAndReconcileFromFile(configPath);

    expect(second.organization.id).toBe(first.organization.id);
    expect(second.organization.name).toBe('Bound Org Updated');
    expect(repo.getOrganization(other.id)?.name).toBe('Other Org');
    expect(repo.getWorkspaceSetting(first.organization.id, 'config_sync.path')).toBe(configPath);
  });

  it('archives dropped config-managed channels even when they fall past the first page', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');
    const channels = makeChannels(55);

    await writeConfigFile(
      configPath,
      teamConfig({
        roles: [
          {
            name: 'pm',
            title: 'Product Manager',
            instructions: 'Lead the work.',
            workspaceScopes: ['.'],
            tools: ['filesystem'],
            channels: ['channel-01'],
          },
          {
            name: 'frontend-engineer',
            title: 'Frontend Engineer',
            instructions: 'Build the product.',
            provider: 'openai',
            model: 'gpt-5.4',
            workspaceScopes: ['apps/web'],
            tools: ['filesystem', 'shell'],
            channels: ['channel-01'],
          },
        ],
        channels,
      }),
    );
    const first = await syncService.loadAndReconcileFromFile(configPath);

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    await writeConfigFile(
      configPath,
      teamConfig({
        roles: [
          {
            name: 'pm',
            title: 'Product Manager',
            instructions: 'Lead the work.',
            workspaceScopes: ['.'],
            tools: ['filesystem'],
            channels: ['channel-02'],
          },
          {
            name: 'frontend-engineer',
            title: 'Frontend Engineer',
            instructions: 'Build the product.',
            provider: 'openai',
            model: 'gpt-5.4',
            workspaceScopes: ['apps/web'],
            tools: ['filesystem', 'shell'],
            channels: ['channel-02'],
          },
        ],
        channels: channels.filter((channel) => channel.name !== 'channel-01'),
      }),
    );
    await syncService.loadAndReconcileFromFile(configPath, first.organization.id);

    expect(repo.getChannel(first.organization.id, 'channel-01')?.archivedAt).toBeTruthy();
  });
});
