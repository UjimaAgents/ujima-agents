import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBufferLogger, createRuntimeHost, Repository, type RuntimeHost } from '@ujima/runtime-core';
import { OrganizationSchema } from '@ujima/shared';
import {
  AuthService,
  BootstrapService,
  createApiServices,
  createTeamStore,
  OnboardingService,
  TEAM_CONFIG_SETTING_KEY,
} from '@ujima/orchestrator';
import { createTransport, type Transport } from '../src/transport/server.js';
import type { LLMProvider } from '@ujima/llm/legacy';

const TOKEN = 'c'.repeat(64);

function stubProvider(): LLMProvider {
  throw new Error('no provider configured');
}

describe('workspace routes', () => {
  let homeDir: string;
  let host: RuntimeHost;
  let transport: Transport;
  let baseUrl: string;
  let sessionToken: string;
  let organizationId: string;
  let repo: Repository;

  const authHeaders = () => ({
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    'x-ujima-session': sessionToken,
  });

  beforeAll(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'ujima-workspaces-'));
    host = await createRuntimeHost(
      {
        homeDir,
        logger: createBufferLogger(),
        loadAgent: async () => undefined,
        loadTeam: async () => undefined,
        resolveMCPDef: async (_w, id) => {
          throw new Error(`no mcp ${id}`);
        },
        getProvider: stubProvider,
      },
      {},
    );

    repo = new Repository(host.db.raw);
    const teamStore = createTeamStore();
    const auth = new AuthService(repo);
    const bootstrap = new BootstrapService(repo, teamStore, auth);
    const onboarding = new OnboardingService(repo, teamStore);

    transport = createTransport({
      host,
      token: TOKEN,
      logger: createBufferLogger(),
      bindHost: '127.0.0.1',
      port: 0,
      apiServices: {
        repo,
        buildServices: (realtime) =>
          createApiServices({
            repo,
            teamStore,
            workspaces: host.workspaces,
            realtime,
            permissions: host.permissions,
            buildPermissionContext: () => ({}),
          }),
      },
    });
    await transport.listen();
    baseUrl = transport.url;

    const onboardingResponse = await fetch(`${baseUrl}/api/onboarding`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationName: 'Workspace Org',
        ownerName: 'Owner',
        ownerEmail: 'owner@workspaces.test',
        ownerPassword: 'correct horse battery staple',
        workspaceRoot: homeDir,
        providerKeys: { openai: 'test-key' },
        team: {
          channels: [{ name: 'general', kind: 'general', topic: 'General' }],
          roles: [
            {
              name: 'frontend-engineer',
              title: 'Frontend Engineer',
              instructions: 'Build the UI',
              provider: 'openai',
              model: 'gpt-4.1',
              workspaceScopes: ['.'],
              channels: ['general'],
            },
          ],
          agents: [{ name: 'frontend-engineer', roleName: 'frontend-engineer' }],
          providers: {
            openai: {
              kind: 'openai',
            },
          },
        },
      }),
    });
    expect(onboardingResponse.status).toBe(200);
    const onboardingBody = (await onboardingResponse.json()) as {
      organization: { id: string };
      sessionToken: string;
    };
    organizationId = onboardingBody.organization.id;
    sessionToken = onboardingBody.sessionToken;
  }, 20_000);

  afterAll(async () => {
    if (transport) await transport.close();
    if (host) await host.shutdown({ drainMs: 500 });
    if (homeDir) {
      try {
        await rm(homeDir, { recursive: true, force: true });
      } catch {
        // Windows may keep temp dirs locked briefly after shutdown.
      }
    }
  });

  it('rejects workspace list without a session', async () => {
    const response = await fetch(`${baseUrl}/api/workspaces`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('ERR_UNAUTHORIZED');
  });

  it('lists accessible workspaces with organization names as labels', async () => {
    const response = await fetch(`${baseUrl}/api/workspaces`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': sessionToken,
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workspaces: Array<{ id: string; label: string | null; is_current?: boolean }>;
      current_workspace_id: string | null;
    };
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]?.id).toBe(`ws_${organizationId}`);
    expect(body.workspaces[0]?.label).toBe('Workspace Org');
    expect(body.workspaces[0]?.is_current).toBe(true);
    expect(body.current_workspace_id).toBe(`ws_${organizationId}`);
  });

  it('creates a second workspace as a new starter organization and can switch to it', async () => {
    const otherHome = await mkdtemp(join(tmpdir(), 'ujima-ws-other-'));
    const staleHome = await mkdtemp(join(tmpdir(), 'ujima-ws-stale-'));
    try {
      repo.saveWorkspaceSetting(
        organizationId,
        TEAM_CONFIG_SETTING_KEY,
        JSON.stringify({
          name: 'Stale Parent Config',
          workspace: { root: homeDir, roleScopes: {} },
          roles: [
            {
              name: 'stale-role',
              title: 'Stale Role',
              instructions: 'Old workspace role.',
              workspaceScopes: [staleHome],
              tools: [],
              channels: ['general'],
            },
          ],
          agents: [{ name: 'stale-agent', roleName: 'stale-role' }],
          channels: [{ name: 'general', kind: 'general', topic: 'General' }],
          providers: { openai: { kind: 'openai' } },
        }),
      );
      repo.saveWorkspaceSetting(
        organizationId,
        'dashboard.teamOverrides',
        JSON.stringify({
          roles: [
            {
              name: 'stale-role',
              title: 'Stale Role',
              instructions: 'Old workspace role.',
              workspaceScopes: [staleHome],
              tools: [],
              channels: ['general'],
            },
          ],
          agents: [],
        }),
      );

      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          root_path: otherHome,
          label: 'Second Workspace',
          copy_providers: ['openai'],
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as {
        id: string;
        root_path: string | null;
        label: string | null;
        is_current?: boolean;
      };
      expect(created.label).toBe('Second Workspace');
      expect(created.root_path).toBe(otherHome);
      expect(created.is_current).toBe(false);

      const newOrganizationId = created.id.replace(/^ws_/, '');
      const storedTeam = repo.getWorkspaceSetting(newOrganizationId, TEAM_CONFIG_SETTING_KEY);
      expect(storedTeam).toBeTruthy();
      expect(storedTeam).not.toContain(staleHome);
      expect(normalize(storedTeam!)).toContain(normalize(otherHome));
      expect(repo.getWorkspaceSetting(newOrganizationId, 'dashboard.teamOverrides')).toBeNull();
      expect(repo.getProviderCredential(newOrganizationId, 'openai')).toBe('test-key');

      const parsedTeam = JSON.parse(storedTeam!) as { agents?: unknown[]; roles?: unknown[] };
      expect(parsedTeam.agents ?? []).toEqual([]);
      expect(parsedTeam.roles ?? []).toHaveLength(1);
      const agentMembers = repo
        .listMembers(newOrganizationId)
        .filter((member) => member.kind === 'agent' && !member.retiredAt);
      expect(agentMembers).toHaveLength(0);
      const ownerMember = repo
        .listMembers(newOrganizationId)
        .find((member) => member.kind === 'human' && member.roleName === 'owner');
      expect(ownerMember?.id).toBe('owner');

      const listResponse = await fetch(`${baseUrl}/api/workspaces`, {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-ujima-session': sessionToken,
        },
      });
      expect(listResponse.status).toBe(200);
      const listed = (await listResponse.json()) as {
        workspaces: Array<{ id: string; label: string | null; is_current?: boolean }>;
      };
      expect(listed.workspaces).toHaveLength(2);
      expect(listed.workspaces).toContainEqual(
        expect.objectContaining({
          id: created.id,
          label: 'Second Workspace',
          is_current: false,
        }),
      );

      const switchResponse = await fetch(`${baseUrl}/api/auth/switch-org`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ organizationId: newOrganizationId }),
      });
      expect(switchResponse.status).toBe(200);
      const switched = (await switchResponse.json()) as { sessionToken: string };
      sessionToken = switched.sessionToken;

      const bootstrapResponse = await fetch(`${baseUrl}/api/bootstrap`, {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-ujima-session': switched.sessionToken,
        },
      });
      expect(bootstrapResponse.status).toBe(200);
      const bootstrapBody = (await bootstrapResponse.json()) as {
        organization: { id: string; name: string } | null;
        team: { workspaceRoot: string } | null;
      };
      expect(bootstrapBody.organization?.id).toBe(newOrganizationId);
      expect(bootstrapBody.organization?.name).toBe('Second Workspace');
      expect(bootstrapBody.team?.workspaceRoot).toBe(otherHome);

      const restoreResponse = await fetch(`${baseUrl}/api/auth/switch-org`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ organizationId }),
      });
      expect(restoreResponse.status).toBe(200);
      const restored = (await restoreResponse.json()) as { sessionToken: string };
      sessionToken = restored.sessionToken;
    } finally {
      await rm(otherHome, { recursive: true, force: true });
      await rm(staleHome, { recursive: true, force: true });
    }
  });

  it('allows creating the same project folder again after delete', async () => {
    const recreateHome = await mkdtemp(join(tmpdir(), 'ujima-ws-recreate-'));
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          root_path: recreateHome,
          label: 'Recreate Workspace',
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as { id: string };
      const createdOrgId = created.id.replace(/^ws_/, '');

      const deleteResponse = await fetch(
        `${baseUrl}/api/workspaces/${encodeURIComponent(created.id)}`,
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'x-ujima-session': sessionToken,
          },
        },
      );
      expect(deleteResponse.status).toBe(200);
      expect(repo.getOrganization(createdOrgId)).toBeNull();

      const recreateResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          root_path: recreateHome,
          label: 'Recreate Workspace Again',
        }),
      });
      expect(recreateResponse.status).toBe(200);
      const recreated = (await recreateResponse.json()) as {
        id: string;
        root_path: string | null;
        label: string | null;
      };
      expect(recreated.root_path).toBe(recreateHome);
      expect(recreated.label).toBe('Recreate Workspace Again');
      const recreatedOrgId = recreated.id.replace(/^ws_/, '');
      expect(repo.getProviderCredential(recreatedOrgId, 'openai')).toBeNull();
    } finally {
      await rm(recreateHome, { recursive: true, force: true });
    }
  });

  it('reclaims orphan organizations at the same path when creating a workspace', async () => {
    const orphanHome = await mkdtemp(join(tmpdir(), 'ujima-ws-orphan-'));
    try {
      const orphanOrgId = randomUUID();
      repo.saveOrganization(
        OrganizationSchema.parse({
          id: orphanOrgId,
          name: 'Zombie Workspace',
          workspace: { root: orphanHome, roleScopes: {} },
          organizationChart: { reportsTo: {} },
        }),
      );
      host.workspaces.create({
        id: `ws_orphan_${randomUUID().slice(0, 8)}`,
        root_path: resolve(orphanHome),
        label: 'Orphan catalog row',
      });
      expect(
        repo.listOrganizationsWithSignIn().some((org) => org.id === orphanOrgId),
      ).toBe(false);

      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          root_path: orphanHome,
          label: 'Reclaimed Workspace',
        }),
      });
      expect(createResponse.status).toBe(200);
      expect(repo.getOrganization(orphanOrgId)).toBeNull();
      const created = (await createResponse.json()) as { id: string; label: string | null };
      expect(created.label).toBe('Reclaimed Workspace');
    } finally {
      await rm(orphanHome, { recursive: true, force: true });
    }
  });
});
