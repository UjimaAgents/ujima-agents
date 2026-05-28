import { describe, expect, it } from 'vitest';
import { OrganizationSchema } from '@ujima/shared';
import { ConfigSyncService } from './config-sync.js';
import { createTeamStore } from './team-store.js';

describe('ConfigSyncService.discardInvalidStoredTeamConfig', () => {
  it('clears invalid persisted team.config instead of crashing bootstrap', () => {
    const org = OrganizationSchema.parse({
      id: 'org-1',
      name: 'Test Org',
      workspace: { root: '/tmp/ws', roleScopes: {} },
      organizationChart: { reportsTo: {} },
    });
    const invalid = JSON.stringify({
      name: 'Test Org',
      workspace: { root: '/tmp/ws' },
      roles: [
        {
          name: 'frontend-engineer',
          title: 'Frontend',
          instructions: 'x',
          tools: [],
          provider: 'missing-provider',
        },
      ],
      agents: [{ name: 'a', roleName: 'frontend-engineer' }],
      channels: [],
      providers: {},
    });

    let deleted = false;
    const repo = {
      getOrganization: () => org,
      getLatestOrganization: () => org,
      getWorkspaceSetting: (_orgId: string, key: string) =>
        key === 'team.config' ? invalid : null,
      deleteWorkspaceSetting: (_orgId: string, key: string) => {
        if (key === 'team.config') deleted = true;
      },
      saveWorkspaceSetting: () => undefined,
      listMembers: () => [],
      listAllChannels: () => [],
      listConfigFieldOwnership: () => [],
    };

    const teamStore = createTeamStore();
    const sync = new ConfigSyncService(repo as never, teamStore);
    const loaded = sync.loadFromStoredConfig(org.id);

    expect(loaded).toBeNull();
    expect(deleted).toBe(true);
    expect(teamStore.getTeam(org.id)).toBeNull();
  });
});
