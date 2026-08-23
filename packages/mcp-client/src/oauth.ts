import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/**
 * OAuth 2.1 + PKCE client for remote MCP connectors ("Track A" catalog
 * entries). Implements the authorization-code flow the MCP auth spec
 * describes:
 *
 *   1. Discover the resource server's authorization server via
 *      `/.well-known/oauth-protected-resource` (falling back to the
 *      resource origin itself).
 *   2. Read the AS metadata (`/.well-known/oauth-authorization-server`).
 *   3. Register a dynamic OAuth client (RFC 7591) — public client,
 *      PKCE required, no client secret.
 *   4. Run the authorization-code + S256 PKCE dance against a local
 *      loopback callback server.
 *   5. Exchange / refresh tokens.
 *
 * Tokens never touch disk here — callers persist them through the
 * secret store (headersKeyRef on the mcp_servers row).
 */

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods?: string[];
}

export interface RegisteredClient {
  clientId: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. Absent when the AS did not send `expires_in`. */
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

export class OAuthFlowError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OAuthFlowError';
    this.status = status;
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function createPkcePair(): PkcePair {
  const verifier = base64url(randomBytes(32));
  const challenge = pkceChallenge(verifier);
  return { verifier, challenge };
}

function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new OAuthFlowError(
      `oauth: ${init?.method ?? 'GET'} ${url} failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  return res.json();
}

/**
 * Resolve the authorization-server issuer for an MCP resource URL per
 * the protected-resource metadata spec. Falls back to the resource
 * origin when the well-known document is absent (404), which is what
 * several vendors shipped before publishing metadata.
 */
export async function discoverAuthorizationServer(resourceUrl: string): Promise<string> {
  const url = new URL(resourceUrl);
  const wellKnown = joinUrl(url.origin, '/.well-known/oauth-protected-resource');
  try {
    const doc = (await fetchJson(wellKnown)) as { authorization_servers?: string[] };
    const first = doc.authorization_servers?.[0];
    if (first) return first;
  } catch (err) {
    // 404 → no metadata document; fall through to origin fallback.
    // Any other failure is a real discovery error worth surfacing.
    if (!(err instanceof OAuthFlowError && err.status === 404)) throw err;
  }
  return url.origin;
}

const AUTH_METADATA_PATHS = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
];

export async function fetchAuthorizationServerMetadata(
  issuer: string,
): Promise<AuthorizationServerMetadata> {
  let lastError: unknown;
  for (const path of AUTH_METADATA_PATHS) {
    try {
      return (await fetchJson(joinUrl(issuer, path))) as AuthorizationServerMetadata;
    } catch (err) {
      lastError = err;
    }
  }
  // RFC 8414 path-inserted form for issuers that live under a path
  // (`https://auth.example.com/tenant1` →
  // `/.well-known/oauth-authorization-server/tenant1`).
  try {
    const issuerUrl = new URL(issuer);
    if (issuerUrl.pathname && issuerUrl.pathname !== '/') {
      return (await fetchJson(
        joinUrl(
          issuerUrl.origin,
          `/.well-known/oauth-authorization-server${issuerUrl.pathname.replace(/\/+$/, '')}`,
        ),
      )) as AuthorizationServerMetadata;
    }
  } catch (err) {
    lastError = err;
  }
  throw new OAuthFlowError(
    `oauth: authorization server metadata not found for ${issuer}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export async function registerDynamicClient(
  metadata: AuthorizationServerMetadata,
  redirectUris: string[],
  clientName = 'Ujima Agents',
): Promise<RegisteredClient> {
  if (!metadata.registration_endpoint) {
    throw new OAuthFlowError(
      'oauth: authorization server does not advertise a dynamic registration endpoint',
    );
  }
  const doc = (await fetchJson(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })) as { client_id?: string };
  if (!doc.client_id) {
    throw new OAuthFlowError('oauth: dynamic registration response missing client_id');
  }
  return { clientId: doc.client_id };
}

export function buildAuthorizationUrl(input: {
  metadata: AuthorizationServerMetadata;
  clientId: string;
  redirectUri: string;
  verifier: string;
  state: string;
  resource: string;
  scope?: string;
}): string {
  const url = new URL(input.metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', pkceChallenge(input.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.scope) url.searchParams.set('scope', input.scope);
  // RFC 8706 resource indicator — MCP servers validate the audience.
  url.searchParams.set('resource', input.resource);
  return url.toString();
}

interface TokenResponseDoc {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

function toTokenSet(doc: TokenResponseDoc): OAuthTokenSet {
  if (!doc.access_token) {
    throw new OAuthFlowError(
      `oauth: token endpoint returned no access_token${
        doc.error ? ` (${doc.error}${doc.error_description ? `: ${doc.error_description}` : ''})` : ''
      }`,
    );
  }
  return {
    accessToken: doc.access_token,
    ...(doc.refresh_token ? { refreshToken: doc.refresh_token } : {}),
    ...(typeof doc.expires_in === 'number'
      ? { expiresAt: Date.now() + doc.expires_in * 1000 }
      : {}),
    ...(doc.token_type ? { tokenType: doc.token_type } : {}),
    ...(doc.scope ? { scope: doc.scope } : {}),
  };
}

async function postTokenForm(
  tokenEndpoint: string,
  form: Record<string, string>,
): Promise<OAuthTokenSet> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const doc = (await res.json().catch(() => ({}))) as TokenResponseDoc;
  if (!res.ok) {
    throw new OAuthFlowError(
      `oauth: token request failed (${res.status})${
        doc.error ? `: ${doc.error}${doc.error_description ? ` — ${doc.error_description}` : ''}` : ''
      }`,
      res.status,
    );
  }
  return toTokenSet(doc);
}

export function exchangeAuthorizationCode(input: {
  metadata: AuthorizationServerMetadata;
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  resource: string;
}): Promise<OAuthTokenSet> {
  return postTokenForm(input.metadata.token_endpoint, {
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    resource: input.resource,
  });
}

export function refreshAccessToken(input: {
  metadata: AuthorizationServerMetadata;
  refreshToken: string;
  clientId: string;
  resource: string;
}): Promise<OAuthTokenSet> {
  return postTokenForm(input.metadata.token_endpoint, {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    resource: input.resource,
  });
}

export function isTokenExpired(tokens: OAuthTokenSet, skewMs = 30_000): boolean {
  if (!tokens.expiresAt) return false;
  return Date.now() >= tokens.expiresAt - skewMs;
}

export interface LoopbackCallback {
  redirectUri: string;
  waitForCallback(timeoutMs?: number): Promise<URLSearchParams>;
  close(): Promise<void>;
}

/**
 * Binds an ephemeral 127.0.0.1 listener and resolves the vendor's
 * redirect. The redirect URI is therefore an exact
 * `http://127.0.0.1:<port>/callback` — safe to hand to dynamic
 * registration and the authorize request.
 */
export async function startLoopbackCallback(): Promise<LoopbackCallback> {
  let settle: ((params: URLSearchParams) => void) | undefined;
  const server: Server = createServer((req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem">' +
        '<h2>Ujima connector authorized</h2><p>You can close this tab.</p></body></html>',
      () => {
        const resolveRef = settle;
        settle = undefined;
        resolveRef?.(parsed.searchParams);
      },
    );
  });
  const actualPort = await new Promise<number>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveListen(typeof address === 'object' && address ? address.port : 0);
    });
  });
  return {
    redirectUri: `http://127.0.0.1:${actualPort}/callback`,
    waitForCallback(timeoutMs = 5 * 60_000) {
      return new Promise<URLSearchParams>((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          settle = undefined;
          rejectPromise(new OAuthFlowError('oauth: timed out waiting for the provider callback'));
        }, timeoutMs);
        settle = (params) => {
          clearTimeout(timer);
          settle = undefined;
          resolvePromise(params);
        };
      });
    },
    close() {
      return new Promise((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

export interface ConnectorOAuthResult {
  tokens: OAuthTokenSet;
  /** `Authorization: Bearer <accessToken>` header map for headersKeyRef. */
  headers: Record<string, string>;
  metadata: AuthorizationServerMetadata;
  client: RegisteredClient;
}

/**
 * Full flow: discovery → registration → local loopback listener → user
 * visits the authorize URL in their browser → code exchange. Returns
 * ready-to-store bearer headers.
 */
export async function runConnectorOAuthFlow(input: {
  resourceUrl: string;
  scope?: string;
  /** Called with the authorization URL so the host can open a browser. */
  openAuthorizeUrl?: (url: string) => void;
  timeoutMs?: number;
}): Promise<ConnectorOAuthResult> {
  const resource = new URL(input.resourceUrl).toString();
  const issuer = await discoverAuthorizationServer(resource);
  const metadata = await fetchAuthorizationServerMetadata(issuer);
  const cb = await startLoopbackCallback();
  try {
    const client = await registerDynamicClient(metadata, [cb.redirectUri]);
    const verifier = createPkcePair();
    const state = randomUUID();
    const authorizeUrl = buildAuthorizationUrl({
      metadata,
      clientId: client.clientId,
      redirectUri: cb.redirectUri,
      verifier: verifier.verifier,
      state,
      resource,
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
    });
    input.openAuthorizeUrl?.(authorizeUrl);
    const params = await cb.waitForCallback(input.timeoutMs);
    const error = params.get('error');
    if (error) {
      throw new OAuthFlowError(
        `oauth: provider returned "${error}"${
          params.get('error_description') ? `: ${params.get('error_description')}` : ''
        }`,
      );
    }
    const code = params.get('code');
    if (!code) throw new OAuthFlowError('oauth: callback missing "code" parameter');
    if (params.get('state') !== state) {
      throw new OAuthFlowError('oauth: state mismatch — possible CSRF, aborting');
    }
    const tokens = await exchangeAuthorizationCode({
      metadata,
      code,
      verifier: verifier.verifier,
      redirectUri: cb.redirectUri,
      clientId: client.clientId,
      resource,
    });
    return {
      tokens,
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      metadata,
      client,
    };
  } finally {
    await cb.close();
  }
}
