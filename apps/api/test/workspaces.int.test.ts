import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBufferLogger, createRuntimeHost, Repository, type RuntimeHost } from '@ujima/runtime-core';
import {
  AuthService,
  BootstrapService,
  ACTIVE_WORKSPACE_SETTING_KEY,
  OnboardingService,
  SettingsService,
  createTeamStore,
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
  let auth: AuthService;

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
    auth = new AuthService(repo);
    const bootstrap = new BootstrapService(repo, teamStore, auth);
    const onboarding = new OnboardingService(repo, teamStore);
    const settings = new SettingsService(repo, teamStore);

    transport = createTransport({
      host,
      token: TOKEN,
      logger: createBufferLogger(),
      bindHost: '127.0.0.1',
      port: 0,
      apiServices: {
        repo,
        buildServices: () =>
          ({
            conversations: {},
            runs: {},
            approvals: {},
            auth,
            bootstrap,
            onboarding,
            settings,
            taskPromoter: {},
            scheduler: { start: () => {}, stop: () => {} },
          }) as never,
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

  it('lists workspaces for the authenticated organization', async () => {
    const response = await fetch(`${baseUrl}/api/workspaces`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': sessionToken,
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workspaces: Array<{ id: string; is_current?: boolean }>;
      current_workspace_id: string | null;
    };
    expect(body.workspaces.length).toBeGreaterThan(0);
    expect(body.current_root_path).toBeTruthy();
  });

  it('requires a session to create a workspace', async () => {
    const otherHome = await mkdtemp(join(tmpdir(), 'ujima-ws-other-'));
    try {
      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          root_path: otherHome,
          label: 'Secondary workspace',
        }),
      });
      expect(response.status).toBe(401);
    } finally {
      await rm(otherHome, { recursive: true, force: true });
    }
  });

  it('creates a workspace when authenticated', async () => {
    const otherHome = await mkdtemp(join(tmpdir(), 'ujima-ws-other-'));
    try {
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'x-ujima-session': sessionToken,
        },
        body: JSON.stringify({
          root_path: otherHome,
          label: 'Secondary workspace',
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as { id: string; root_path: string };
      expect(created.root_path).toBe(otherHome);

      const listResponse = await fetch(`${baseUrl}/api/workspaces`, {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-ujima-session': sessionToken,
        },
      });
      expect(listResponse.status).toBe(200);
      const listed = (await listResponse.json()) as { workspaces: Array<{ id: string }> };
      expect(listed.workspaces.some((workspace) => workspace.id === created.id)).toBe(true);
    } finally {
      await rm(otherHome, { recursive: true, force: true });
    }
  });

  it('does not leak shared-root workspaces across organizations', async () => {
    const otherOrganizationId = 'org-shared-root';
    repo.saveOrganization(
      {
        id: otherOrganizationId,
        name: 'Shared Root Org',
        workspace: { root: homeDir, roleScopes: {} },
        organizationChart: { reportsTo: {} },
      },
    );
    repo.saveMember({
      id: 'shared-root-owner',
      organizationId: otherOrganizationId,
      name: 'Shared Root Owner',
      kind: 'human',
      roleName: 'owner',
    });
    const otherSessionToken = auth.registerOwnerAccount({
      organizationId: otherOrganizationId,
      memberId: 'shared-root-owner',
      email: 'shared-root-owner@example.com',
      password: 'correct horse battery staple',
    }).sessionToken;

    const sharedWorkspace = host.workspaces.create({
      root_path: homeDir,
      label: 'Shared root workspace',
    });
    try {
      const listResponse = await fetch(`${baseUrl}/api/workspaces`, {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-ujima-session': otherSessionToken,
        },
      });
      expect(listResponse.status).toBe(200);
      const body = (await listResponse.json()) as { workspaces: Array<{ id: string }> };
      expect(body.workspaces.some((workspace) => workspace.id === sharedWorkspace.id)).toBe(false);
    } finally {
      host.workspaces.remove(sharedWorkspace.id);
    }
  });

  it('rejects activation for a workspace not linked to the organization', async () => {
    const otherHome = await mkdtemp(join(tmpdir(), 'ujima-ws-unlinked-'));
    let workspaceId = '';
    try {
      const workspace = host.workspaces.create({
        root_path: otherHome,
        label: 'Unlinked workspace',
      });
      workspaceId = workspace.id;
      const activateResponse = await fetch(
        `${baseUrl}/api/workspaces/${encodeURIComponent(workspace.id)}/activate`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${TOKEN}`,
            'x-ujima-session': sessionToken,
          },
        },
      );
      expect(activateResponse.status).toBe(404);
    } finally {
      if (workspaceId) host.workspaces.remove(workspaceId);
      await rm(otherHome, { recursive: true, force: true });
    }
  });

  it('clears the active workspace setting when deleting the active workspace', async () => {
    const otherHome = tmpdir();
    const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'x-ujima-session': sessionToken,
      },
      body: JSON.stringify({
        root_path: otherHome,
        label: 'Active workspace',
      }),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { id: string };

    const activateResponse = await fetch(
      `${baseUrl}/api/workspaces/${encodeURIComponent(created.id)}/activate`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-ujima-session': sessionToken,
        },
      },
    );
    expect(activateResponse.status).toBe(200);

    const deleteResponse = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': sessionToken,
      },
    });
    expect(deleteResponse.status).toBe(200);
    expect(repo.getWorkspaceSetting(organizationId, ACTIVE_WORKSPACE_SETTING_KEY)).toBeNull();

    const listResponse = await fetch(`${baseUrl}/api/workspaces`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': sessionToken,
      },
    });
    expect(listResponse.status).toBe(200);
    const body = (await listResponse.json()) as { current_workspace_id: string | null };
    expect(body.current_workspace_id).not.toBe(created.id);
  });
});
