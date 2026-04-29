import { describe, it, expect } from 'vitest';
import { createClient, UjimaApiError } from './index';

describe('client-sdk', () => {
  it('trims trailing slashes from baseUrl', () => {
    const c = createClient({ baseUrl: 'http://localhost:7511///', token: 't' });
    expect(c.baseUrl).toBe('http://localhost:7511');
  });

  it('maps non-ok fetch responses to UjimaApiError', async () => {
    const stub: typeof fetch = async () =>
      new Response(JSON.stringify({ code: 'ERR_UNAUTHORIZED', message: 'nope' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    const client = createClient({ baseUrl: 'http://x', token: 't', fetchImpl: stub });
    await expect(client.health()).rejects.toBeInstanceOf(UjimaApiError);
  });

  it('sends Bearer token on every request', async () => {
    const seen: string[] = [];
    const stub: typeof fetch = async (_url, init) => {
      seen.push(String((init?.headers as Record<string, string>)?.authorization ?? ''));
      return new Response(JSON.stringify({ workspaces: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = createClient({ baseUrl: 'http://x', token: 'abc123', fetchImpl: stub });
    await client.workspaces.list();
    expect(seen).toEqual(['Bearer abc123']);
  });

  it('calls the role catalog endpoints', async () => {
    const seen: string[] = [];
    const stub: typeof fetch = async (url, _init) => {
      seen.push(new URL(String(url)).pathname);
      if (String(url).endsWith('/roles/presets')) {
        return new Response(JSON.stringify({ presets: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).endsWith('/roles/industries')) {
        return new Response(JSON.stringify({ industries: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ industry: 'engineering', presets: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = createClient({ baseUrl: 'http://x', token: 'abc123', fetchImpl: stub });
    await client.roles.listPresets();
    await client.roles.listIndustries();
    await client.roles.getIndustry('engineering');

    expect(seen).toEqual([
      '/api/roles/presets',
      '/api/roles/industries',
      '/api/roles/industries/engineering',
    ]);
  });
});
