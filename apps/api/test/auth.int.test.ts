import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBufferLogger, createRuntimeHost, Repository, type RuntimeHost } from '@ujima/runtime-core';
import {
  AuthService,
  BootstrapService,
  OnboardingService,
  createTeamStore,
} from '@ujima/orchestrator';
import { createTransport, type Transport } from '../src/transport/server';
import type { LLMProvider } from '@ujima/llm/legacy';

const TOKEN = 'b'.repeat(64);

function stubProvider(): LLMProvider {
  throw new Error('no provider configured');
}

describe('auth flow', () => {
  let homeDir: string;
  let host: RuntimeHost;
  let transport: Transport;
  let baseUrl: string;

  beforeAll(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'ujima-auth-'));
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
            settings: {},
            taskPromoter: {},
          } as any),
      },
    });
    await transport.listen();
    baseUrl = transport.url;
  }, 15_000);

  afterAll(async () => {
    await transport.close();
    await host.shutdown({ drainMs: 500 });
    await rm(homeDir, { recursive: true, force: true });
  });

  it('onboarding creates an owner session that bootstrap can restore', async () => {
    const onboardingResponse = await fetch(`${baseUrl}/api/onboarding`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationName: 'Auth Org',
        ownerName: 'Owner',
        ownerEmail: 'owner@example.com',
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
    const onboarding = (await onboardingResponse.json()) as {
      organization: { id: string };
      auth: { authenticated: boolean; user: { email: string } | null };
      sessionToken: string;
    };
    expect(onboarding.auth.authenticated).toBe(true);
    expect(onboarding.auth.user?.email).toBe('owner@example.com');
    expect(onboarding.sessionToken).toMatch(/^[a-f0-9]{64}$/);

    const anonymousBootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const anonymousBody = (await anonymousBootstrap.json()) as {
      auth: { authenticated: boolean };
    };
    expect(anonymousBody.auth.authenticated).toBe(false);

    const sessionBootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': onboarding.sessionToken,
      },
    });
    const sessionBody = (await sessionBootstrap.json()) as {
      organization: { id: string } | null;
      auth: { authenticated: boolean; user: { email: string } | null; member: { name: string } | null };
    };
    expect(sessionBody.organization?.id).toBe(onboarding.organization.id);
    expect(sessionBody.auth.authenticated).toBe(true);
    expect(sessionBody.auth.user?.email).toBe('owner@example.com');
    expect(sessionBody.auth.member?.name).toBe('Owner');
  });

  it('supports login, invalid credentials, and logout', async () => {
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: 'missing',
        email: 'owner@example.com',
        password: 'wrong password',
      }),
    });
    expect(badLogin.status).toBe(401);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'owner@example.com',
        password: 'correct horse battery staple',
      }),
    });
    expect(loginResponse.status).toBe(200);
    const login = (await loginResponse.json()) as {
      auth: { authenticated: boolean; session: { expiresAt: string } | null };
      sessionToken: string;
    };
    expect(login.auth.authenticated).toBe(true);
    expect(login.auth.session?.expiresAt).toMatch(/^20/);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': login.sessionToken,
      },
    });
    expect(logoutResponse.status).toBe(200);
    expect(await logoutResponse.json()).toEqual({ loggedOut: true });

    const sessionAfterLogout = await fetch(`${baseUrl}/api/auth/session`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': login.sessionToken,
      },
    });
    expect(await sessionAfterLogout.json()).toMatchObject({
      authenticated: false,
      user: null,
      member: null,
      session: null,
    });
  });
});
