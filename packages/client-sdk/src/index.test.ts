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
});
