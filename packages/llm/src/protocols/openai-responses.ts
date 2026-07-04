export interface OpenAIResponsesRequestBody extends Record<string, unknown> {
  stream?: unknown;
  background?: unknown;
}

export interface OpenAIResponsesStreamEvent extends Record<string, unknown> {
  type?: string;
}

export async function prepareOpenAIResponsesRequest(
  request: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Promise<{ request: Parameters<typeof fetch>[0]; init: Parameters<typeof fetch>[1] }> {
  if (typeof init?.body === 'string') return { request, init };
  if (!(request instanceof Request) || init?.body) return { request, init };

  const body = await request.clone().text();
  if (!body.trim().startsWith('{')) return { request, init };
  return { request: new Request(request, { body }), init };
}

export function shouldUseOpenAIResponsesSocket(
  request: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): { url: URL; body: OpenAIResponsesRequestBody } | null {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (init?.method !== 'POST' || !url.pathname.endsWith('/responses')) return null;
  if (typeof init.body !== 'string') return null;
  const body = safeParseOpenAIResponsesBody(init.body);
  if (!body || body.stream !== true) return null;
  return { url, body };
}

export function stripOpenAIResponsesTransportFields(body: OpenAIResponsesRequestBody): Record<string, unknown> {
  const { stream: _stream, background: _background, ...payload } = body;
  return payload;
}

export function parseOpenAIResponsesEvent(text: string): OpenAIResponsesStreamEvent | null {
  try {
    const value = JSON.parse(text) as OpenAIResponsesStreamEvent;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function isOpenAIResponsesDoneEvent(event: OpenAIResponsesStreamEvent): boolean {
  return event.type === 'response.completed' || event.type === 'response.done';
}

export function openAIResponsesTerminalError(event: OpenAIResponsesStreamEvent): Error | null {
  if (event.type !== 'response.failed' && event.type !== 'response.incomplete' && event.type !== 'error') {
    return null;
  }
  const message =
    objectMessage(event.error) ??
    objectMessage((event.response as { error?: unknown } | undefined)?.error) ??
    objectMessage((event.response as { incomplete_details?: unknown } | undefined)?.incomplete_details) ??
    (typeof event.message === 'string' ? event.message : undefined) ??
    `OpenAI Responses ${event.type}`;
  const error = new Error(message);
  error.name = 'AI_APICallError';
  return error;
}

function safeParseOpenAIResponsesBody(body: string): OpenAIResponsesRequestBody | null {
  try {
    const value = JSON.parse(body) as OpenAIResponsesRequestBody;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function objectMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.code === 'string' && typeof record.message === 'string') {
    return `${record.code}: ${record.message}`;
  }
  if (typeof record.message === 'string') return record.message;
  if (typeof record.reason === 'string') return record.reason;
  if (typeof record.code === 'string') return record.code;
  return undefined;
}
