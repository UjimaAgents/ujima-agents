import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import WebSocket from 'ws';

type FetchHeaders = NonNullable<Parameters<typeof fetch>[1]>['headers'];
const CODEX_RESPONSES_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_DUMMY_API_KEY = 'ujima-codex-oauth';
const DEFAULT_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_AUTH_ISSUER = 'https://auth.openai.com';
const RESPONSES_WS_PROTOCOL = 'responses_websockets=2026-02-06';
let refreshPromise: Promise<StoredCodexToken | null> | null = null;

interface CodexResponsesOptions {
  modelId: string;
  accessToken: string;
  baseUrl?: string;
}

interface StoredCodexToken {
  accessToken: string;
  accountId?: string;
}

interface StoredCodexAuth {
  tokens?: {
    id_token?: unknown;
    access_token?: unknown;
    refresh_token?: unknown;
    expires_at?: unknown;
    account_id?: unknown;
  };
}

export function createCodexResponsesModel(options: CodexResponsesOptions): LanguageModel {
  return createOpenAI({
    apiKey: CODEX_DUMMY_API_KEY,
    baseURL: options.baseUrl ?? CODEX_RESPONSES_BASE_URL,
    fetch: codexFetch(options.accessToken),
  }).responses(options.modelId);
}

function codexFetch(accessToken: string): typeof fetch {
  let bearer = accessToken;
  let accountId = envAccountId() ?? extractAccountId(accessToken);
  let socket: WebSocket | null = null;
  const itemCache = new Map<string, unknown>();
  const sessionId = crypto.randomUUID();

  return async (request, init) => {
    const refreshed = await maybeRefreshStoredToken();
    if (refreshed) {
      bearer = refreshed.accessToken;
      accountId = envAccountId() ?? refreshed.accountId ?? extractAccountId(refreshed.accessToken);
    }

    const prepared = await prepareRequest(request, withAuthHeaders(init, bearer, accountId, sessionId), itemCache);
    const response = await fetchCodex(prepared.request, prepared.init, {
      getSocket: () => socket,
      setSocket: (next) => { socket = next; },
      itemCache,
    });
    if (response.status !== 401) return response;

    const retryToken = await refreshStoredToken();
    if (!retryToken) return response;
    bearer = retryToken.accessToken;
    accountId = envAccountId() ?? retryToken.accountId ?? extractAccountId(retryToken.accessToken);
    const retry = await prepareRequest(request, withAuthHeaders(init, bearer, accountId, sessionId), itemCache);
    return fetchCodex(retry.request, retry.init, {
      getSocket: () => socket,
      setSocket: (next) => { socket = next; },
      itemCache,
    });
  };
}

function withAuthHeaders(
  init: Parameters<typeof fetch>[1],
  bearer: string,
  accountId: string | undefined,
  sessionId: string,
): Parameters<typeof fetch>[1] {
  const headers = new Headers(init?.headers);
  headers.delete('authorization');
  headers.delete('Authorization');
  headers.set('authorization', `Bearer ${bearer}`);
  headers.set('originator', 'ujima');
  headers.set('User-Agent', 'ujima');
  headers.set('session-id', sessionId);
  if (accountId) headers.set('ChatGPT-Account-Id', accountId);
  return { ...init, headers };
}

async function fetchCodex(
  request: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  pool: { getSocket: () => WebSocket | null; setSocket: (socket: WebSocket | null) => void; itemCache: Map<string, unknown> },
): Promise<Response> {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (init?.method !== 'POST' || !url.pathname.endsWith('/responses')) return fetch(request, init);
  if (typeof init.body !== 'string') return fetch(request, init);

  const body = JSON.parse(init.body) as { stream?: unknown };
  if (body.stream !== true) return fetch(request, init);

  const socket = await openSocket(url, init.headers, pool);
  return streamSocket(socket, body, init.signal ?? undefined, pool.itemCache, () => {
    pool.setSocket(null);
  });
}

async function openSocket(
  url: URL,
  headersInit: FetchHeaders | undefined,
  pool: { getSocket: () => WebSocket | null; setSocket: (socket: WebSocket | null) => void },
): Promise<WebSocket> {
  const current = pool.getSocket();
  if (current?.readyState === WebSocket.OPEN) return current;

  const headers = normalizeHeaders(headersInit);
  headers['openai-beta'] ??= RESPONSES_WS_PROTOCOL;
  delete headers['content-length'];

  const socket = new WebSocket(url.toString().replace(/^http/, 'ws'), { headers });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('Codex WebSocket connect timed out'));
    }, 15_000);
    socket.once('open', () => {
      clearTimeout(timeout);
      pool.setSocket(socket);
      resolve();
    });
    socket.once('error', (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('close', (code: number, reason: Buffer) => {
      clearTimeout(timeout);
      reject(new Error(`Codex WebSocket closed before open (${code}: ${reason.toString()})`));
    });
  });
  return socket;
}

function streamSocket(
  socket: WebSocket,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  itemCache: Map<string, unknown>,
  invalidate: () => void,
): Response {
  const encoder = new TextEncoder();
  let done = false;

  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (idleTimer) clearTimeout(idleTimer);
        socket.off('message', onMessage);
        socket.off('error', onError);
        socket.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
      };
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => fail(new Error('Codex WebSocket idle timeout')), 60_000);
      };
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      };
      const fail = (error: Error) => {
        if (done) return;
        done = true;
        cleanup();
        invalidate();
        socket.terminate();
        controller.error(error);
      };
      const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) {
          fail(new Error('Unexpected binary Codex WebSocket frame'));
          return;
        }
        const text = data.toString();
        resetIdle();
        controller.enqueue(encoder.encode(`data: ${text.replace(/\r?\n/g, '\ndata: ')}\n\n`));
        const event = safeJson(text);
        if (!event) return;
        rememberCachedItems(event, itemCache);
        if (event.type === 'response.completed' || event.type === 'response.done') finish();
        if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') finish();
      };
      const onError = (error: Error) => fail(error);
      const onClose = (code: number, reason: Buffer) => {
        if (!done) fail(new Error(`Codex WebSocket closed (${code}: ${reason.toString()})`));
      };
      const onAbort = () => fail(new DOMException('Aborted', 'AbortError'));

      socket.on('message', onMessage);
      socket.once('error', onError);
      socket.once('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });

      const { stream: _stream, background: _background, ...payload } = body;
      resetIdle();
      socket.send(JSON.stringify({ type: 'response.create', ...payload }), (error?: Error) => {
        if (error) fail(error);
      });
    },
    cancel() {
      invalidate();
      socket.terminate();
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function normalizeHeaders(headersInit: FetchHeaders | undefined): Record<string, string> {
  const headers = new Headers(headersInit);
  const record: Record<string, string> = {};
  headers.forEach((value, key) => { record[key.toLowerCase()] = value; });
  return record;
}

function safeJson(text: string): { type?: string } | null {
  try {
    const value = JSON.parse(text) as { type?: string };
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function prepareRequest(
  request: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  itemCache: Map<string, unknown>,
): Promise<{ request: Parameters<typeof fetch>[0]; init: Parameters<typeof fetch>[1] }> {
  if (typeof init?.body === 'string') {
    return { request, init: { ...init, body: rewriteBody(init.body, itemCache) } };
  }
  if (!(request instanceof Request) || init?.body) return { request, init };

  const body = await request.clone().text();
  if (!body.trim().startsWith('{')) return { request, init };
  return { request: new Request(request, { body: rewriteBody(body, itemCache) }), init };
}

function rewriteBody(body: string, itemCache: Map<string, unknown>): string {
  try {
    const json = replaceItemReferences(JSON.parse(body), itemCache) as { max_output_tokens?: unknown; store?: unknown };
    json.store = false;
    delete json.max_output_tokens;
    return JSON.stringify(json);
  } catch {
    return body;
  }
}

function replaceItemReferences(value: unknown, itemCache: Map<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceItemReferences(item, itemCache));
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if (record.type === 'item_reference' && typeof record.id === 'string') {
    const cached = itemCache.get(record.id);
    if (cached) return stripItemId(cached);
  }

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    next[key] = replaceItemReferences(entry, itemCache);
  }
  return next;
}

function stripItemId(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripItemId);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === 'id') continue;
    next[key] = stripItemId(entry);
  }
  return next;
}

function rememberCachedItems(value: unknown, itemCache: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    for (const entry of value) rememberCachedItems(entry, itemCache);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (typeof record.id === 'string' && typeof record.type === 'string' && !record.type.startsWith('response.')) {
    itemCache.set(record.id, record);
  }

  for (const entry of Object.values(record)) rememberCachedItems(entry, itemCache);
}

function authPath(): string {
  return join(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'), 'auth.json');
}

function readAuth(): StoredCodexAuth | null {
  try {
    return JSON.parse(readFileSync(authPath(), 'utf8')) as StoredCodexAuth;
  } catch {
    return null;
  }
}

async function maybeRefreshStoredToken(): Promise<StoredCodexToken | null> {
  const expiresAt = readAuth()?.tokens?.expires_at;
  if (typeof expiresAt !== 'number' || expiresAt - Date.now() > 60_000) return null;
  return refreshStoredToken();
}

async function refreshStoredToken(): Promise<StoredCodexToken | null> {
  refreshPromise ??= refreshStoredTokenOnce().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function refreshStoredTokenOnce(): Promise<StoredCodexToken | null> {
  const auth = readAuth();
  const refreshToken = auth?.tokens?.refresh_token;
  if (typeof refreshToken !== 'string' || !refreshToken.trim()) return null;

  const response = await fetch(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.UJIMA_CODEX_CLIENT_ID ?? DEFAULT_CODEX_CLIENT_ID,
    }).toString(),
  });
  if (!response.ok) return null;

  const tokens = await response.json() as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) return null;

  const accountId = extractAccountId(tokens.id_token ?? tokens.access_token);
  const path = authPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    ...auth,
    auth_mode: 'chatgpt',
    tokens: {
      ...auth?.tokens,
      id_token: tokens.id_token ?? auth?.tokens?.id_token,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refreshToken,
      expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      account_id: accountId ?? auth?.tokens?.account_id,
    },
  }, null, 2), { mode: 0o600 });

  return { accessToken: tokens.access_token, accountId };
}

function envAccountId(): string | undefined {
  return process.env.UJIMA_CODEX_ACCOUNT_ID ?? process.env.CHATGPT_ACCOUNT_ID;
}

function extractAccountId(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      chatgpt_account_id?: string;
      organizations?: { id?: string }[];
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
    };
    return claims.chatgpt_account_id ?? claims['https://api.openai.com/auth']?.chatgpt_account_id ?? claims.organizations?.[0]?.id;
  } catch {
    return undefined;
  }
}
