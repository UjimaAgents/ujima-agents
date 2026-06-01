import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeHost, createBufferLogger, type RuntimeHost } from '@ujima/runtime-core';
import { Repository } from '@ujima/runtime-core';
import { createApiServices, createTeamStore } from '@ujima/orchestrator';
import { createClient, UjimaApiError } from '@ujima/client-sdk';
import { createTransport, type Transport } from '../src/transport/server';
import type { LanguageModel } from 'ai';

const TOKEN = 'a'.repeat(64);
const stubLanguageModel = {} as unknown as LanguageModel;

describe('transport (in-process)', () => {
  let homeDir: string;
  let host: RuntimeHost;
  let transport: Transport;
  let baseUrl: string;
  let sessionToken: string;

  beforeAll(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'ujima-transport-'));
    host = await createRuntimeHost(
      {
        homeDir,
        logger: createBufferLogger(),
        loadAgent: async () => undefined,
        loadTeam: async () => undefined,
        resolveMCPDef: async (_w, id) => { throw new Error(`no mcp ${id}`); },
        getModel: () => stubLanguageModel,
      },
      {},
    );
    const apiRepo = new Repository(host.db.raw);
    const teamStore = createTeamStore();

    transport = createTransport({
      host,
      token: TOKEN,
      logger: createBufferLogger(),
      bindHost: '127.0.0.1',
      port: 0,
      apiServices: {
        repo: apiRepo,
        buildServices: (realtime) =>
          createApiServices({
            repo: apiRepo,
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
        organizationName: 'Transport Org',
        ownerName: 'Owner',
        ownerEmail: 'owner@transport.test',
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
          providers: { openai: { kind: 'openai' } },
        },
      }),
    });
    expect(onboardingResponse.status).toBe(200);
    const onboardingBody = (await onboardingResponse.json()) as { sessionToken: string };
    sessionToken = onboardingBody.sessionToken;
  }, 20_000);

  afterAll(async () => {
    await transport.close();
    await host.shutdown({ drainMs: 500 });
    await rm(homeDir, { recursive: true, force: true });
  });

  it('refuses non-loopback bind without TLS', () => {
    expect(() =>
      createTransport({
        host,
        token: TOKEN,
        logger: createBufferLogger(),
        bindHost: '0.0.0.0',
        port: 0,
      }),
    ).toThrow(/non-loopback/);
  });

  it('rejects requests without a bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ERR_UNAUTHORIZED');
  });

  it('rejects requests with a wrong bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/workspaces`, { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('starts OpenAI Codex OAuth with the OpenAI login URL', async () => {
    const res = await fetch(`${baseUrl}/api/auth/openai/login`, { redirect: 'manual' });
    expect(res.status).toBe(302);

    const location = res.headers.get('location');
    expect(location).toBeTruthy();
    const url = new URL(location ?? '');
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.openai.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
    expect(url.searchParams.get('scope')).toBe('openid profile email offline_access');
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+\/api\/auth\/openai\/callback$/);
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true');
  });

  it('returns health with a correct bearer token', async () => {
    const client = createClient({ baseUrl, token: TOKEN });
    const h = await client.health();
    expect(h.status).toBe('ok');
    expect(h.pid).toBe(process.pid);
  });

  it('serves the role catalog endpoints', async () => {
    const headers = { authorization: `Bearer ${TOKEN}` };

    const presetsRes = await fetch(`${baseUrl}/api/roles/presets`, { headers });
    expect(presetsRes.status).toBe(200);
    const presets = (await presetsRes.json()) as { presets: Array<{ key: string; industry: string }> };
    expect(presets.presets.some((preset) => preset.key === 'frontendEngineer')).toBe(true);

    const industriesRes = await fetch(`${baseUrl}/api/roles/industries`, { headers });
    expect(industriesRes.status).toBe(200);
    const industries = (await industriesRes.json()) as {
      industries: Array<{ industry: string; presets: Array<{ key: string }> }>;
    };
    expect(industries.industries.some((group) => group.industry === 'engineering')).toBe(true);

    const engineeringRes = await fetch(`${baseUrl}/api/roles/industries/engineering`, { headers });
    expect(engineeringRes.status).toBe(200);
    const engineering = (await engineeringRes.json()) as {
      industry: string;
      presets: Array<{ key: string }>;
    };
    expect(engineering.industry).toBe('engineering');
    expect(engineering.presets.some((preset) => preset.key === 'frontendEngineer')).toBe(true);
  });

  it('lists the single workspace for the authenticated organization', async () => {
    const listRes = await fetch(`${baseUrl}/api/workspaces`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': sessionToken,
      },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      workspaces: Array<{ id: string; is_current?: boolean }>;
      current_workspace_id: string | null;
    };
    expect(list.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(list.workspaces.every((w) => w.is_current === true)).toBe(true);
    expect(list.current_workspace_id).toBeTruthy();
  });

  it('returns 409 ERR_NO_WORKSPACE_ROOT when starting a task on an unready workspace', async () => {
    const client = createClient({ baseUrl, token: TOKEN });
    try {
      await client.tasks.start({
        workspace_id: 'ghost',
        session_id: 's1',
        team_id: 't1',
        prompt: 'hi',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UjimaApiError);
      const e = err as UjimaApiError;
      expect(e.status).toBe(409);
      expect(e.code).toBe('ERR_NO_WORKSPACE_ROOT');
    }
  });

  it('returns empty lists for tasks and agents when idle', async () => {
    const client = createClient({ baseUrl, token: TOKEN });
    expect((await client.tasks.list()).tasks).toEqual([]);
    expect((await client.agents.list()).agents).toEqual([]);
  });

  it('supports task lookup and kill endpoints', async () => {
    const client = createClient({ baseUrl, token: TOKEN });

    await expect(client.tasks.get('missing')).rejects.toMatchObject({
      status: 404,
      code: 'ERR_NOT_FOUND',
    });
    expect(await client.tasks.kill('missing')).toEqual({ killed: false });
    expect(await client.tasks.killAgent('missing', 'agent')).toEqual({ killed: false });
  });

  it('opens a WS subscription and receives a ready frame', async () => {
    const client = createClient({ baseUrl, token: TOKEN });
    const frames: string[] = [];
    const sub = client.subscribeEvents({ since_ms: 0 }, (f) => {
      frames.push(f.kind);
    });
    try {
      await new Promise<void>((r, rej) => {
        const t = setTimeout(() => rej(new Error(`no ready frame, got ${JSON.stringify(frames)}`)), 5000);
        const iv = setInterval(() => {
          if (frames.includes('ready')) {
            clearInterval(iv);
            clearTimeout(t);
            r();
          }
        }, 50);
      });
      expect(frames).toContain('ready');
    } finally {
      sub.close();
    }
  });

  it('rejects WS connection with a wrong token', async () => {
    const client = createClient({ baseUrl, token: 'wrong-token' });
    const gotError = await new Promise<boolean>((resolvePromise) => {
      const sub = client.subscribeEvents({}, () => {});
      const t = setTimeout(() => {
        sub.close();
        resolvePromise(false);
      }, 2000);
      // socket.io-client raises 'connect_error' on auth failure via the socket
      // itself — we don't expose that in our typed SDK. Use the absence of a
      // ready frame as the auth failure signal.
      const iv = setInterval(() => {
        if (!sub.connected) {
          clearInterval(iv);
          clearTimeout(t);
          sub.close();
          resolvePromise(true);
        }
      }, 50);
    });
    expect(gotError).toBe(true);
  });

  it('stops the scheduler when transport closes', async () => {
    const scheduler = {
      start: vi.fn(),
      stop: vi.fn(),
    };
    const repo = new Repository(host.db.raw);
    const schedTransport = createTransport({
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
            auth: {},
            bootstrap: {},
            onboarding: {},
            settings: {},
            taskSessions: {},
            goals: {},
            spirits: {},
            activeSpirits: {},
            mcpRegistry: {},
            scheduler,
          }) as never,
      },
    });

    await schedTransport.listen();
    expect(scheduler.start).toHaveBeenCalledTimes(1);
    await schedTransport.close();
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
  });
});
