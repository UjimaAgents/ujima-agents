import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildAuthorizationUrl,
  createPkcePair,
  discoverAuthorizationServer,
  exchangeAuthorizationCode,
  fetchAuthorizationServerMetadata,
  isTokenExpired,
  OAuthFlowError,
  refreshAccessToken,
  registerDynamicClient,
  runConnectorOAuthFlow,
  startLoopbackCallback,
} from './oauth';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('pkce', () => {
  it('produces an S256 challenge derived from the verifier', () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('produces unique pairs', () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('discovery', () => {
  it('follows the protected-resource metadata to the AS issuer', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).endsWith('/.well-known/oauth-protected-resource')) {
        return jsonResponse({ resource: 'https://mcp.example.com', authorization_servers: ['https://auth.example.com'] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
    const issuer = await discoverAuthorizationServer('https://mcp.example.com/mcp');
    expect(issuer).toBe('https://auth.example.com');
  });

  it('falls back to the origin on a 404 metadata document', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    const issuer = await discoverAuthorizationServer('https://mcp.example.com/mcp');
    expect(issuer).toBe('https://mcp.example.com');
  });

  it('reads the AS metadata document', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url) === 'https://auth.example.com/.well-known/oauth-authorization-server') {
        return jsonResponse({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register',
        });
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
    const meta = await fetchAuthorizationServerMetadata('https://auth.example.com');
    expect(meta.token_endpoint).toBe('https://auth.example.com/token');
  });
});

describe('registration + authorize url', () => {
  it('registers a public PKCE client', async () => {
    let capturedBody: unknown;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ client_id: 'client_123' });
    }) as typeof fetch;
    const client = await registerDynamicClient(
      {
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        registration_endpoint: 'https://auth.example.com/register',
      },
      ['http://127.0.0.1:5555/callback'],
    );
    expect(client.clientId).toBe('client_123');
    expect(capturedBody).toMatchObject({
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    });
  });

  it('builds an authorize URL carrying PKCE + state + resource', () => {
    const url = buildAuthorizationUrl({
      metadata: {
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
      },
      clientId: 'client_123',
      redirectUri: 'http://127.0.0.1:5555/callback',
      verifier: 'verifier-string',
      state: 'state-abc',
      resource: 'https://mcp.example.com/mcp',
      scope: 'read write',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://auth.example.com/authorize');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
    expect(parsed.searchParams.get('resource')).toBe('https://mcp.example.com/mcp');
    expect(parsed.searchParams.get('scope')).toBe('read write');
  });

  it('refuses to register when the AS has no registration endpoint', async () => {
    await expect(
      registerDynamicClient(
        {
          issuer: 'x',
          authorization_endpoint: 'x',
          token_endpoint: 'x',
        },
        [],
      ),
    ).rejects.toThrow(/dynamic registration endpoint/);
  });
});

describe('token exchange', () => {
  it('exchanges a code for tokens with the verifier', async () => {
    let form: URLSearchParams | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      form = new URLSearchParams(String(init?.body));
      return jsonResponse({ access_token: 'at_1', refresh_token: 'rt_1', expires_in: 3600, token_type: 'Bearer' });
    }) as typeof fetch;
    const tokens = await exchangeAuthorizationCode({
      metadata: {
        issuer: 'i',
        authorization_endpoint: 'i',
        token_endpoint: 'https://auth.example.com/token',
      },
      code: 'the-code',
      verifier: 'the-verifier',
      redirectUri: 'http://127.0.0.1:5555/callback',
      clientId: 'client_123',
      resource: 'https://mcp.example.com/mcp',
    });
    expect(tokens.accessToken).toBe('at_1');
    expect(tokens.refreshToken).toBe('rt_1');
    expect(isTokenExpired(tokens)).toBe(false);
    expect(form?.get('grant_type')).toBe('authorization_code');
    expect(form?.get('code_verifier')).toBe('the-verifier');
    expect(form?.get('resource')).toBe('https://mcp.example.com/mcp');
  });

  it('surfaces provider errors from the token endpoint', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: 'invalid_grant', error_description: 'code expired' }, 400)) as typeof fetch;
    await expect(
      refreshAccessToken({
        metadata: { issuer: 'i', authorization_endpoint: 'i', token_endpoint: 'https://auth.example.com/token' },
        refreshToken: 'stale',
        clientId: 'c',
        resource: 'r',
      }),
    ).rejects.toThrow(OAuthFlowError);
  });
});

describe('loopback callback + full flow', () => {
  it('round-trips a callback through the local listener and completes the flow', async () => {
    const cb = await startLoopbackCallback();
    // Simulate the vendor redirect in parallel.
    const vendorRedirect = fetch(`${cb.redirectUri}?code=vendor-code&state=ok`).then(() => undefined);
    const params = await cb.waitForCallback(5000);
    await vendorRedirect;
    expect(params.get('code')).toBe('vendor-code');
    await cb.close();
  });

  it('runs discovery → registration → browser → exchange end-to-end against stubs', async () => {
    const metadata = {
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      registration_endpoint: 'https://auth.example.com/register',
    };
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      // Loopback callback requests must reach the real local listener.
      if (url.startsWith('http://127.0.0.1')) return originalFetch(input, init);
      if (url.endsWith('/.well-known/oauth-protected-resource')) {
        return jsonResponse({ authorization_servers: ['https://auth.example.com'] });
      }
      if (url.endsWith('/.well-known/oauth-authorization-server')) return jsonResponse(metadata);
      if (url.endsWith('/register')) return jsonResponse({ client_id: 'dyn-client' });
      if (url.startsWith(metadata.authorization_endpoint)) {
        throw new Error('authorize endpoint must not be fetched server-side');
      }
      if (url === metadata.token_endpoint) {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get('grant_type')).toBe('authorization_code');
        return jsonResponse({ access_token: 'final-at', expires_in: 7200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const result = await runConnectorOAuthFlow({
      resourceUrl: 'https://mcp.example.com/mcp',
      // "Browser": hit the loopback listener exactly like the vendor
      // would, echoing back the state the client generated.
      openAuthorizeUrl: (authorizeUrl) => {
        const parsed = new URL(authorizeUrl);
        const redirect = parsed.searchParams.get('redirect_uri');
        const state = parsed.searchParams.get('state');
        expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        setTimeout(() => {
          void fetch(`${redirect}?code=vendor-code&state=${state}`);
        }, 0);
      },
      timeoutMs: 5000,
    });
    expect(result.tokens.accessToken).toBe('final-at');
    expect(result.headers).toEqual({ Authorization: 'Bearer final-at' });
    expect(result.client.clientId).toBe('dyn-client');
    expect(isTokenExpired(result.tokens)).toBe(false);
  });
});
