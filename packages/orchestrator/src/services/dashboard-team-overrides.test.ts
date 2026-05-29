import { describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import { OrganizationSchema } from '@ujima/shared';
import { createAgent, createStarterAgentTeamConfig, loadAgentTeam } from '@ujima/framework';
import { AGENT_KIND } from '@ujima/shared';
import {
  applyDashboardTeamOverrides,
  deleteDashboardTeamOverride,
  upsertDashboardTeamOverride,
} from './dashboard-team-overrides.js';
import { persistTeamConfig } from './config-sync.js';
import { SettingsService } from './settings.js';
import { createTeamStore } from './team-store.js';

describe('dashboard team overrides', () => {
  it('removes a deleted dashboard agent from the live team', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const org = repo.saveOrganization(
      OrganizationSchema.parse({
        id: 'org-delete-override',
        name: 'Delete Override Org',
        workspace: { root: '/tmp/delete-override', roleScopes: {} },
        organizationChart: { reportsTo: {} },
      }),
    );

    const baseTeam = loadAgentTeam(
      createStarterAgentTeamConfig({
        name: org.name,
        workspaceRoot: '/tmp/delete-override',
      }),
    );
    teamStore.setTeam(baseTeam, org.id);
    persistTeamConfig(repo, org.id, baseTeam);

    const dashboardAgent = createAgent('agent-dashboard-1', 'frontend-engineer', 'direct');
    upsertDashboardTeamOverride(repo, org.id, teamStore, {
      agent: dashboardAgent,
    });

    expect(teamStore.getTeam(org.id)?.agents.map((agent) => agent.name)).toContain('agent-dashboard-1');

    deleteDashboardTeamOverride(repo, org.id, teamStore, 'agent-dashboard-1', 'frontend-engineer');

    const liveAgents = teamStore.getTeam(org.id)?.agents.map((agent) => agent.name) ?? [];
    expect(liveAgents).not.toContain('agent-dashboard-1');
    expect(liveAgents).toContain('pm');
  });

  it('re-applies overrides from persisted base config, not stale teamStore state', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const org = repo.saveOrganization(
      OrganizationSchema.parse({
        id: 'org-reapply-override',
        name: 'Reapply Override Org',
        workspace: { root: '/tmp/reapply-override', roleScopes: {} },
        organizationChart: { reportsTo: {} },
      }),
    );

    const baseTeam = loadAgentTeam(
      createStarterAgentTeamConfig({
        name: org.name,
        workspaceRoot: '/tmp/reapply-override',
      }),
    );
    teamStore.setTeam(baseTeam, org.id);
    persistTeamConfig(repo, org.id, baseTeam);

    const dashboardAgent = createAgent('agent-dashboard-2', 'frontend-engineer', 'direct');
    upsertDashboardTeamOverride(repo, org.id, teamStore, { agent: dashboardAgent });
    deleteDashboardTeamOverride(repo, org.id, teamStore, 'agent-dashboard-2', 'frontend-engineer');

    // Simulate stale in-memory team that still lists the deleted agent.
    const staleTeam = teamStore.getTeam(org.id);
    if (!staleTeam) throw new Error('expected team');
    teamStore.setTeam(
      loadAgentTeam({
        ...staleTeam.toJSON(),
        agents: [...staleTeam.agents, dashboardAgent],
      }),
      org.id,
    );
    expect(teamStore.getTeam(org.id)?.agents.map((agent) => agent.name)).toContain('agent-dashboard-2');

    applyDashboardTeamOverrides(repo, org.id, teamStore);

    expect(teamStore.getTeam(org.id)?.agents.map((agent) => agent.name)).not.toContain('agent-dashboard-2');
  });

  it('SettingsService.deleteMember removes the agent from the live team', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const settings = new SettingsService(repo, teamStore);
    const org = repo.saveOrganization(
      OrganizationSchema.parse({
        id: 'org-settings-delete',
        name: 'Settings Delete Org',
        workspace: { root: '/tmp/settings-delete', roleScopes: {} },
        organizationChart: { reportsTo: {} },
      }),
    );

    const baseTeam = loadAgentTeam(
      createStarterAgentTeamConfig({
        name: org.name,
        workspaceRoot: '/tmp/settings-delete',
      }),
    );
    teamStore.setTeam(baseTeam, org.id);
    persistTeamConfig(repo, org.id, baseTeam);

    const saved = settings.addMember({
      organizationId: org.id,
      name: 'delete-me-agent',
      kind: AGENT_KIND,
      roleName: 'frontend-engineer',
    });

    settings.addMember({
      organizationId: org.id,
      name: 'human-owner',
      kind: 'human',
      roleName: 'pm',
    });

    expect(teamStore.getTeam(org.id)?.agents.map((agent) => agent.name)).toContain(saved.id);

    settings.deleteMember(org.id, saved.id);

    const liveAgents = teamStore.getTeam(org.id)?.agents.map((agent) => agent.name) ?? [];
    expect(liveAgents).not.toContain(saved.id);
  });
});
