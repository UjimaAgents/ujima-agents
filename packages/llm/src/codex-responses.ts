import { createHash } from 'node:crypto';
import type { LanguageModel } from 'ai';
import WebSocket from 'ws';
import {
  isOpenAIResponsesDoneEvent,
  openAIResponsesTerminalError,
  parseOpenAIResponsesEvent,
  prepareOpenAIResponsesRequest,
  shouldUseOpenAIResponsesSocket,
  stripOpenAIResponsesTransportFields,
  type OpenAIResponsesRequestBody,
} from './protocols/openai-responses.js';
import { OpenAIResponsesLanguageModel } from './protocols/openai-responses-language-model.js';

type FetchHeaders = NonNullable<Parameters<typeof fetch>[1]>['headers'];
const CODEX_RESPONSES_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const RESPONSES_WS_PROTOCOL = 'responses_websockets=2026-02-06';
const CODEX_WS_OPEN_RETRIES = 2;
const CODEX_WS_IDLE_TIMEOUT_MS = 5 * 60_000;

interface CodexResponsesOptions {
  modelId: string;
  accessToken: string;
  baseUrl?: string;
}

export function createCodexResponsesModel(options: CodexResponsesOptions): LanguageModel {
  return new OpenAIResponsesLanguageModel(options.modelId, {
    preserveItemIds: false,
    supportsMaxOutputTokens: false,
    url: `${options.baseUrl ?? CODEX_RESPONSES_BASE_URL}/responses`,
    fetch: codexFetch(options.accessToken),
  }) as unknown as LanguageModel;
}

function codexFetch(accessToken: string): typeof fetch {
  const bearer = accessToken;
  const accountId = envAccountId() ?? extractAccountId(accessToken);
  const sessionId = stableCodexSessionId(accessToken, accountId);

  return async (request, init) => {
    return requestWithFreshPool(request, init, bearer, accountId, sessionId);
  };
}

async function requestWithFreshPool(
  request: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  bearer: string,
  accountId: string | undefined,
  sessionId: string,
): Promise<Response> {
  let socket: WebSocket | null = null;
  const prepared = await prepareRequest(request, withAuthHeaders(init, bearer, accountId, sessionId));
  return fetchCodex(prepared.request, prepared.init, {
    getSocket: () => socket,
    setSocket: (next) => { socket = next; },
  });
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

export function stableCodexSessionId(accessToken: string, accountId: string | undefined): string {
  const seed = `ujima:${accountId || accessToken}`;
  const hex = createHash('sha256').update(seed).digest('hex');
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

async function fetchCodex(
  request: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  pool: { getSocket: () => WebSocket | null; setSocket: (socket: WebSocket | null) => void },
): Promise<Response> {
  const target = shouldUseOpenAIResponsesSocket(request, init);
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (!target) return logNonOkResponse(url, await fetch(request, init));
  return streamSocket(
    target.url,
    init?.headers,
    pool,
    target.body,
    init?.signal ?? undefined,
    async () => logNonOkResponse(url, await fetch(request, init)),
  );
}

async function logNonOkResponse(url: URL, response: Response): Promise<Response> {
  if (response.ok) return response;
  try {
    const bodyText = await response.clone().text();
    console.error('[codex-response-error]', {
      url: url.toString(),
      status: response.status,
      statusText: response.statusText,
      message: extractResponseMessage(bodyText) ?? bodyText.slice(0, 2000),
    });
  } catch (error) {
    console.error('[codex-response-error]', {
      url: url.toString(),
      status: response.status,
      statusText: response.statusText,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return response;
}

function extractResponseMessage(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const message =
      typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.error === 'string'
          ? parsed.error
          : typeof parsed.detail === 'string'
            ? parsed.detail
            : typeof parsed.title === 'string'
              ? parsed.title
              : null;
    if (message) return message;
    const nested = parsed.error;
    if (nested && typeof nested === 'object') {
      const record = nested as Record<string, unknown>;
      return (
        (typeof record.message === 'string' && record.message) ||
        (typeof record.detail === 'string' && record.detail) ||
        null
      );
    }
  } catch {
    return null;
  }
  return null;
}

async function openSocket(
  url: URL,
  headersInit: FetchHeaders | undefined,
  pool: { getSocket: () => WebSocket | null; setSocket: (socket: WebSocket | null) => void },
  signal: AbortSignal | undefined,
): Promise<WebSocket> {
  const current = pool.getSocket();
  if (current?.readyState === WebSocket.OPEN) return current;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const headers = normalizeHeaders(headersInit);
  headers['openai-beta'] ??= RESPONSES_WS_PROTOCOL;
  delete headers['content-length'];

  const socket = new WebSocket(url.toString().replace(/^http/, 'ws'), { headers });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('Codex WebSocket connect timed out'));
    }, 15_000);
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      socket.terminate();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.once('open', () => {
      cleanup();
      pool.setSocket(socket);
      resolve();
    });
    socket.once('error', (error: Error) => {
      cleanup();
      reject(error);
    });
    socket.once('close', (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`Codex WebSocket closed before open (${code}: ${reason.toString()})`));
    });
  });
  return socket;
}

function streamSocket(
  url: URL,
  headers: FetchHeaders | undefined,
  pool: { getSocket: () => WebSocket | null; setSocket: (socket: WebSocket | null) => void },
  body: OpenAIResponsesRequestBody,
  signal: AbortSignal | undefined,
  fallback: () => Promise<Response>,
): Response {
  const encoder = new TextEncoder();
  let done = false;
  let socket: WebSocket | null = null;

  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let frameCount = 0;
      let attempts = 0;
      const cleanup = () => {
        if (idleTimer) clearTimeout(idleTimer);
        socket?.off('message', onMessage);
        socket?.off('error', onError);
        socket?.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
      };
      const invalidate = () => pool.setSocket(null);
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => fail(new Error('Codex WebSocket idle timeout')), CODEX_WS_IDLE_TIMEOUT_MS);
      };
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        invalidate();
        socket?.close();
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      };
      const abort = () => {
        if (done) return;
        done = true;
        cleanup();
        invalidate();
        socket?.terminate();
        controller.error(new DOMException('Aborted', 'AbortError'));
      };
      const fail = (error: Error) => {
        if (done) return;
        if (!signal?.aborted && frameCount === 0 && attempts <= CODEX_WS_OPEN_RETRIES && resend) {
          cleanup();
          invalidate();
          socket?.terminate();
          resend();
          return;
        }
        done = true;
        cleanup();
        invalidate();
        socket?.terminate();
        if (frameCount === 0 && !signal?.aborted) {
          void fallback().then(async (response) => {
            if (!response.ok || !response.body) {
              controller.error(error);
              return;
            }
            try {
              const reader = response.body.getReader();
              while (true) {
                const next = await reader.read();
                if (next.done) break;
                controller.enqueue(next.value);
              }
              controller.close();
            } catch (fallbackError) {
              controller.error(fallbackError instanceof Error ? fallbackError : error);
            }
          }).catch((fallbackError) => {
            controller.error(fallbackError instanceof Error ? fallbackError : error);
          });
          return;
        }
        controller.error(error);
      };
      const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) {
          fail(new Error('Unexpected binary Codex WebSocket frame'));
          return;
        }
        const text = data.toString();
        frameCount += 1;
        resetIdle();
        controller.enqueue(encoder.encode(`data: ${text.replace(/\r?\n/g, '\ndata: ')}\n\n`));
        const event = parseOpenAIResponsesEvent(text);
        if (!event) return;
        const terminalError = openAIResponsesTerminalError(event);
        if (terminalError) {
          fail(terminalError);
          return;
        }
        if (isOpenAIResponsesDoneEvent(event)) {
          finish();
        }
      };
      const onError = (error: Error) => fail(error);
      const onClose = (code: number, reason: Buffer) => {
        if (!done) fail(new Error(`Codex WebSocket closed (${code}: ${reason.toString()})`));
      };
      const onAbort = () => abort();

      const payload = stripOpenAIResponsesTransportFields(body);
      const send = async () => {
        let lastError: Error | undefined;
        for (; attempts <= CODEX_WS_OPEN_RETRIES; attempts += 1) {
          try {
            socket = await openSocket(url, headers, pool, signal);
            if (signal?.aborted) {
              abort();
              return;
            }
            socket.on('message', onMessage);
            socket.once('error', onError);
            socket.once('close', onClose);
            signal?.addEventListener('abort', onAbort, { once: true });
            resetIdle();
            socket.send(JSON.stringify({ type: 'response.create', ...payload }), (error?: Error) => {
              if (error) fail(error);
            });
            return;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            invalidate();
            if (frameCount > 0 || attempts === CODEX_WS_OPEN_RETRIES) break;
          }
        }
        fail(lastError ?? new Error('Codex WebSocket connect failed'));
      };

      function resend() {
        attempts += 1;
        void send();
      }
      void send();
    },
    cancel() {
      pool.setSocket(null);
      socket?.terminate();
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

export function codexTerminalError(event: { type?: string } & Record<string, unknown>): Error | null {
  return openAIResponsesTerminalError(event);
}

async function prepareRequest(
  request: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Promise<{ request: Parameters<typeof fetch>[0]; init: Parameters<typeof fetch>[1] }> {
  return prepareOpenAIResponsesRequest(request, init);
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
