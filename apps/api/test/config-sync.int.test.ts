import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import { OrganizationSchema } from '@ujima/shared';
import {
  ConversationService,
  ConfigSyncService,
  SettingsService,
  SpiritService,
  TaskPromoterService,
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

function createNoopRealtime() {
  return {
    emit: () => undefined,
  };
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

  it('rehydrates dashboard-created agents and ignores human override pollution on startup', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const settings = new SettingsService(repo, teamStore);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig());
    const first = await syncService.loadAndReconcileFromFile(configPath);

    const human = settings.addMember({
      organizationId: first.organization.id,
      name: 'Owner Two',
      kind: 'human',
      roleName: 'pm',
    });
    expect(repo.getWorkspaceSetting(first.organization.id, 'dashboard.teamOverrides')).toBeNull();

    repo.saveWorkspaceSetting(
      first.organization.id,
      'dashboard.teamOverrides',
      JSON.stringify({
        roles: [],
        agents: [
          {
            name: human.id,
            roleName: 'pm',
            personalityName: 'direct',
          },
        ],
      }),
    );

    const rehydratedStore = createTeamStore();
    const rehydratedSyncService = new ConfigSyncService(repo, rehydratedStore);
    await rehydratedSyncService.loadAndReconcileFromFile(configPath, first.organization.id);
    expect(rehydratedStore.getTeam()?.getAgent(human.id)).toBeUndefined();

    const agent = settings.addMember({
      organizationId: first.organization.id,
      name: 'frontend-beta',
      kind: 'agent',
      roleName: 'frontend-engineer',
    });

    const rehydratedStore2 = createTeamStore();
    const rehydratedSyncService2 = new ConfigSyncService(repo, rehydratedStore2);
    await rehydratedSyncService2.loadAndReconcileFromFile(configPath, first.organization.id);
    expect(rehydratedStore2.getTeam()?.getAgent(agent.id)?.name).toBe(agent.id);
  });

  it('preserves provider and model when dashboard overrides an existing config role', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const settings = new SettingsService(repo, teamStore);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig());
    const first = await syncService.loadAndReconcileFromFile(configPath);

    settings.addMember({
      organizationId: first.organization.id,
      name: 'frontend-beta',
      kind: 'agent',
      roleName: 'frontend-engineer',
      role: {
        name: 'frontend-engineer',
        title: 'Frontend Engineer',
        instructions: 'Build the product.',
        workspaceScopes: ['apps/web'],
        tools: ['filesystem', 'shell'],
        channels: ['general'],
        skills: [],
      },
    });

    expect(teamStore.getTeam()?.getRole('frontend-engineer')?.provider).toBe('openai');
    expect(teamStore.getTeam()?.getRole('frontend-engineer')?.model).toBe('gpt-5.4');

    const hydratedStore = createTeamStore();
    const hydratedSyncService = new ConfigSyncService(repo, hydratedStore);
    await hydratedSyncService.loadAndReconcileFromFile(configPath, first.organization.id);

    expect(hydratedStore.getTeam()?.getRole('frontend-engineer')?.provider).toBe('openai');
    expect(hydratedStore.getTeam()?.getRole('frontend-engineer')?.model).toBe('gpt-5.4');
  });

  it('drops stale absolute dashboard role scopes after workspace root changes', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const settings = new SettingsService(repo, teamStore);
    const oldRoot = await mkdtemp(join(tmpdir(), 'ujima-old-root-'));
    const newRoot = await mkdtemp(join(tmpdir(), 'ujima-new-root-'));
    tempDirs.push(oldRoot, newRoot);
    const configPath = join(oldRoot, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig({ workspace: { root: oldRoot, roleScopes: {} } }));
    const first = await syncService.loadAndReconcileFromFile(configPath);

    settings.addMember({
      organizationId: first.organization.id,
      name: 'frontend-beta',
      kind: 'agent',
      roleName: 'frontend-engineer',
      role: {
        name: 'frontend-engineer',
        title: 'Frontend Engineer',
        instructions: 'Build the product.',
        workspaceScopes: [oldRoot],
        tools: ['filesystem', 'shell'],
        channels: ['general'],
        skills: [],
      },
    });

    repo.saveOrganization({
      ...first.organization,
      workspace: { ...first.organization.workspace, root: newRoot },
    });

    const hydratedStore = createTeamStore();
    const hydratedSyncService = new ConfigSyncService(repo, hydratedStore);
    expect(() => hydratedSyncService.loadFromStoredConfig(first.organization.id)).not.toThrow();
    expect(hydratedStore.getTeam()?.getRole('frontend-engineer')?.workspaceScopes).toEqual([newRoot]);
  });

  it('preserves member provider and model when partial member updates omit them', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const settings = new SettingsService(repo, teamStore);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig());
    const first = await syncService.loadAndReconcileFromFile(configPath);

    const agent = settings.addMember({
      organizationId: first.organization.id,
      name: 'frontend-beta',
      kind: 'agent',
      roleName: 'frontend-engineer',
      llm: 'openai',
      model: 'gpt-5.4',
    });

    const updated = settings.updateMember({
      organizationId: first.organization.id,
      memberId: agent.id,
      name: 'frontend-beta-renamed',
      roleName: 'frontend-engineer',
      personalityName: 'direct',
      channelIds: ['general'],
      role: {
        name: 'frontend-engineer',
        title: 'Frontend Engineer',
        instructions: 'Build the product.',
        workspaceScopes: ['apps/web'],
        tools: ['filesystem', 'shell'],
        channels: ['general'],
        skills: [],
      },
    });

    expect(updated.llm).toBe('openai');
    expect(updated.model).toBe('gpt-5.4');
  });

  it('rejects new agent members when the role does not already exist and no role object is provided', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const settings = new SettingsService(repo, teamStore);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig());
    const first = await syncService.loadAndReconcileFromFile(configPath);
    const membersBefore = repo.listMembers(first.organization.id).length;

    expect(() =>
      settings.addMember({
        organizationId: first.organization.id,
        name: 'research-alpha',
        kind: 'agent',
        roleName: 'research-analyst',
      }),
    ).toThrow(/Role "research-analyst" not found/);

    expect(repo.listMembers(first.organization.id).length).toBe(membersBefore);
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
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
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

    // Force identical timestamps across every channel row to simulate the
    // pagination edge case from the review. Reconcile now uses an unpaginated
    // scan, so duplicate created_at values cannot hide channels from archival.
    db.prepare('UPDATE channels SET created_at = ?, updated_at = ? WHERE organization_id = ?').run(
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      first.organization.id,
    );

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

  it('rejects new messages to archived config-managed channels', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const conversations = new ConversationService(repo, createNoopRealtime());
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig());
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
            channels: ['general'],
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
        channels: [
          {
            name: 'general',
            kind: 'general',
            topic: 'General coordination',
          },
        ],
      }),
    );
    await syncService.loadAndReconcileFromFile(configPath, first.organization.id);

    expect(() =>
      conversations.sendMessage({
        organizationId: first.organization.id,
        threadId: 'triage-thread',
        channelId: 'triage',
        senderId: 'pm',
        content: 'still here?',
      }),
    ).toThrow(/channel is archived/i);
  });

  it('rejects retired config agents from new runs and task promotion', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const realtime = createNoopRealtime();
    const conversations = new ConversationService(repo, realtime);
    const runs = new SpiritService(
      teamStore,
      repo,
      realtime,
      { allowRun: () => undefined, invoke: async () => ({ ok: true }) } as never,
      {
        conversations,
        ai: { generateRunReply: async () => ({ text: '', toolResults: [], steps: [] }) } as never,
      },
    );
    const promoter = new TaskPromoterService(repo, runs);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig());
    const first = await syncService.loadAndReconcileFromFile(configPath);

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    await writeConfigFile(
      configPath,
      teamConfig({
        agents: [
          {
            name: 'pm',
            roleName: 'pm',
            personalityName: 'direct',
          },
        ],
        organizationChart: { reportsTo: {} },
      }),
    );
    await syncService.loadAndReconcileFromFile(configPath, first.organization.id);

    await expect(
      runs.createRun({
        organizationId: first.organization.id,
        agentId: 'frontend-alice',
        threadId: 'triage-thread',
        summary: 'do work',
      }),
    ).rejects.toThrow(/retired/i);

    await expect(
      promoter.promote({
        organizationId: first.organization.id,
        channelId: 'general',
        requestedBy: 'pm',
        prompt: 'take this task',
        assignedAgentId: 'frontend-alice',
      }),
    ).rejects.toThrow(/no agent member available/i);

    const retiredAgent = repo.getMember(first.organization.id, 'frontend-alice');
    expect(retiredAgent?.retiredAt).toBeTruthy();
  });

  // Regression: visibleChannels() in config-sync used to drop only `self`
  // channels, leaking `dm` channels into the reconcile response payload.
  // The reconcile result is consumed by the dashboard / CLI / UI shells with
  // no caller-scoped visibility filter, so any private 2-member DM that
  // exists in the DB would have been exposed to whoever held the daemon
  // token. Both `self` and `dm` must be filtered, matching the rule used in
  // bootstrap/settings/onboarding and the SQL-side filter on listChannels.
  it('reconcile response strips both self and dm channels', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-leak-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig());
    const first = await syncService.loadAndReconcileFromFile(configPath);

    // Persist a self-channel + a DM directly into the org. These are runtime
    // artefacts (member-spawn / first-DM-send), not config-managed rows, so
    // they survive subsequent reconciles.
    repo.saveChannel({
      id: 'self_pm',
      organizationId: first.organization.id,
      name: 'self_pm',
      kind: 'self',
      topic: '',
      memberIds: ['pm'],
    });
    repo.saveChannel({
      id: 'dm_pm_alice',
      organizationId: first.organization.id,
      name: 'dm_pm_alice',
      kind: 'dm',
      topic: '',
      memberIds: ['pm', 'frontend-alice'],
    });

    // Sanity: the rows really are in the DB.
    expect(repo.getChannel(first.organization.id, 'self_pm')?.kind).toBe('self');
    expect(repo.getChannel(first.organization.id, 'dm_pm_alice')?.kind).toBe('dm');

    // Re-reconcile (config unchanged). Pre-fix, `result.channels` carried
    // `dm_pm_alice`; `self_pm` was already filtered.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    const second = await syncService.loadAndReconcileFromFile(configPath, first.organization.id);
    const ids = second.channels.map((channel) => channel.id);
    expect(ids).toContain('general');
    expect(ids).toContain('triage');
    expect(ids).not.toContain('self_pm');
    expect(ids).not.toContain('dm_pm_alice');
  });

  it('can delete/retire a dashboard-created agent, removes its overrides, and rejects deleting humans', async () => {
    const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    const teamStore = createTeamStore();
    const syncService = new ConfigSyncService(repo, teamStore);
    const settings = new SettingsService(repo, teamStore);
    const dir = await mkdtemp(join(tmpdir(), 'ujima-config-sync-delete-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'ujima.config.js');

    await writeConfigFile(configPath, teamConfig());
    const first = await syncService.loadAndReconcileFromFile(configPath);
    repo.saveWorkspaceSetting(first.organization.id, 'config_sync.path', configPath);

    // 1. Add a new agent member
    const agent = settings.addMember({
      organizationId: first.organization.id,
      name: 'delete-me-agent',
      kind: 'agent',
      roleName: 'frontend-engineer',
    });

    const storedOverridesBefore = repo.getWorkspaceSetting(first.organization.id, 'dashboard.teamOverrides');
    expect(storedOverridesBefore).toBeTruthy();
    expect(JSON.parse(storedOverridesBefore!).agents).toContainEqual(
      expect.objectContaining({ name: agent.id })
    );

    // 2. Try to delete a human member
    const human = settings.addMember({
      organizationId: first.organization.id,
      name: 'human-owner',
      kind: 'human',
      roleName: 'pm',
    });
    expect(() => settings.deleteMember(first.organization.id, human.id)).toThrow(/Only agents can be deleted/);

    // 3. Delete the agent member
    settings.deleteMember(first.organization.id, agent.id);

    // 4. Verify agent has retiredAt timestamp set
    const deletedAgent = repo.getMember(first.organization.id, agent.id);
    expect(deletedAgent?.retiredAt).toBeTruthy();

    // 5. Verify agent is removed from dashboard team overrides
    const storedOverridesAfter = repo.getWorkspaceSetting(first.organization.id, 'dashboard.teamOverrides');
    expect(storedOverridesAfter).toBeTruthy();
    expect(JSON.parse(storedOverridesAfter!).agents).not.toContainEqual(
      expect.objectContaining({ name: agent.id })
    );
  });
});
