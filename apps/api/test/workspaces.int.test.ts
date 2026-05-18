import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBufferLogger, createRuntimeHost, Repository, type RuntimeHost } from '@ujima/runtime-core';
import {
  AuthService,
  BootstrapService,
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

    const repo = new Repository(host.db.raw);
    const teamStore = createTeamStore();
    const auth = new AuthService(repo);
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
    } finally {
      await rm(otherHome, { recursive: true, force: true });
    }
  });
});
