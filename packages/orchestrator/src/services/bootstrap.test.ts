import { describe, expect, it } from 'vitest';
import { loadAgentTeam } from '@ujima/framework';
import { MemberSchema, OrganizationSchema } from '@ujima/shared';
import { BootstrapService } from './bootstrap.js';
import { createTeamStore } from './team-store.js';

describe('BootstrapService', () => {
  it('uses the session organization and reloads that org team', () => {
    const org1 = OrganizationSchema.parse({
      id: 'org-1',
      name: 'Latest Org',
      workspace: { root: '/tmp/latest', roleScopes: {} },
      organizationChart: { reportsTo: {} },
    });
    const org2 = OrganizationSchema.parse({
      id: 'org-2',
      name: 'Session Org',
      workspace: { root: '/tmp/session', roleScopes: {} },
      organizationChart: { reportsTo: {} },
    });
    const team1 = loadAgentTeam({
      name: 'Latest Org',
      workspace: { root: '/tmp/latest' },
      roles: [
        {
          name: 'lead',
          title: 'Lead',
          instructions: 'Lead the work.',
          tools: [],
        },
      ],
      agents: [{ name: 'latest-agent', roleName: 'lead' }],
      channels: [],
      providers: {},
    });
    const team2 = loadAgentTeam({
      name: 'Session Org',
      workspace: { root: '/tmp/session' },
      roles: [
        {
          name: 'lead',
          title: 'Lead',
          instructions: 'Lead the work.',
          tools: [],
        },
      ],
      agents: [{ name: 'session-agent', roleName: 'lead' }],
      channels: [],
      providers: {},
    });
    const member = MemberSchema.parse({
      id: 'member-2',
      organizationId: org2.id,
      name: 'Sam',
      kind: 'human',
      roleName: 'owner',
      presence: 'offline',
    });

    let snapshotOrgId: string | undefined;
    const repo = {
      getLatestOrganization: () => org1,
      listOrganizations: () => [org1, org2],
      listOrganizationsWithSignIn: () => [org1, org2],
      getOrganization: (organizationId: string) => (organizationId === org2.id ? org2 : org1),
      getWorkspaceSetting: (_organizationId: string, key: string) => {
        if (key !== 'team.config') return null;
        return JSON.stringify(team2.toJSON());
      },
      listMembers: () => [],
      listAllChannels: () => [],
      listProviderCredentials: () => ({}),
      saveWorkspaceSetting: () => undefined,
      getBootstrapSnapshot: (organizationId?: string) => {
        snapshotOrgId = organizationId;
        return {
          organization: organizationId === org2.id ? org2 : org1,
          members: [],
          channels: [],
          pendingApprovals: [],
          activeRuns: [],
          providerCredentials: {},
        };
      },
      listOrganizationSkillInstalls: () => [],
    };
    const auth = {
      getAuthState: (sessionToken?: string | null) => sessionToken === 'token-1'
        ? {
            authenticated: true,
            user: { id: 'user-1', organizationId: org2.id, memberId: member.id, email: 'sam@example.com' },
            member,
            session: { id: 'session-1', organizationId: org2.id, memberId: member.id, expiresAt: '2026-06-01T00:00:00.000Z' },
          }
        : {
            authenticated: false,
            user: null,
            member: null,
            session: null,
          },
      listAccessibleOrganizations: () => [org1, org2],
    };
    const teamStore = createTeamStore(team1);
    const service = new BootstrapService(repo as never, teamStore, auth as never);

    const response = service.getBootstrap({ sessionToken: 'token-1' });

    expect(snapshotOrgId).toBe(org2.id);
    expect(response.organization?.id).toBe(org2.id);
    expect(response.team?.name).toBe('Session Org');
    expect(teamStore.getTeam()?.config.name).toBe('Session Org');
    expect(service.getBootstrap().organizations.map((org) => org.id)).toEqual([org1.id, org2.id]);
  });

  it('returns bootstrap when stored team config fails validation', () => {
    const org = OrganizationSchema.parse({
      id: 'org-bad',
      name: 'Bad Config Org',
      workspace: { root: '/tmp/bad', roleScopes: {} },
      organizationChart: { reportsTo: {} },
    });
    const invalidStoredTeam = {
      name: 'Bad Config Org',
      workspace: { root: '/tmp/bad' },
      roles: [
        {
          name: 'frontend-engineer',
          title: 'Frontend',
          instructions: 'Build UI.',
          tools: [],
          provider: 'deepseek',
        },
      ],
      agents: [{ name: 'dev', roleName: 'frontend-engineer' }],
      channels: [],
      providers: {},
    };
    let deletedTeamConfig = false;
    const repo = {
      getLatestOrganization: () => org,
      listOrganizations: () => [org],
      listOrganizationsWithSignIn: () => [org],
      getOrganization: () => org,
      getWorkspaceSetting: (_organizationId: string, key: string) =>
        key === 'team.config' ? JSON.stringify(invalidStoredTeam) : null,
      deleteWorkspaceSetting: (_organizationId: string, key: string) => {
        if (key === 'team.config') deletedTeamConfig = true;
      },
      listMembers: () => [],
      listAllChannels: () => [],
      listProviderCredentials: () => ({}),
      saveWorkspaceSetting: () => undefined,
      getBootstrapSnapshot: () => ({
        organization: org,
        members: [],
        channels: [],
        pendingApprovals: [],
        activeRuns: [],
        providerCredentials: {},
      }),
      listOrganizationSkillInstalls: () => [],
    };
    const auth = {
      getAuthState: () => ({
        authenticated: false,
        user: null,
        member: null,
        session: null,
      }),
      listAccessibleOrganizations: () => [org],
    };
    const failures: Record<string, unknown>[] = [];
    const teamStore = createTeamStore();
    const service = new BootstrapService(repo as never, teamStore, auth as never, (message, context) => {
      failures.push({ message, ...context });
    });

    const response = service.getBootstrap();

    expect(response.serviceReady).toBe(true);
    expect(response.organization?.id).toBe(org.id);
    expect(response.team).toBeNull();
    expect(deletedTeamConfig).toBe(true);
    expect(failures).toHaveLength(0);
  });
});
