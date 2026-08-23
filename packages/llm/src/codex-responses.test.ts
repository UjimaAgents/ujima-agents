import { generateText, streamText } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexTerminalError, createCodexResponsesModel, stableCodexSessionId } from './codex-responses.js';
import { selectLanguageModel } from './select.js';

const FailingWebSocket = vi.hoisted(() => class {
  static OPEN = 1;
  readyState = 0;
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor() {
    queueMicrotask(() => this.emit('error', new Error('socket unavailable')));
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const once = (...args: any[]) => {
      this.off(event, once);
      listener(...args);
    };
    return this.on(event, once);
  }

  on(event: string, listener: (...args: any[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  terminate(): void {
    this.readyState = 3;
  }

  close(): void {
    this.readyState = 3;
  }

  send(_payload: string, callback?: (error?: Error) => void): void {
    callback?.();
  }

  private emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
});

vi.mock('ws', () => ({ default: FailingWebSocket }));

describe('stableCodexSessionId', () => {
  it('returns a valid UUID-shaped session id', () => {
    expect(stableCodexSessionId('token', undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('codexTerminalError', () => {
  it('preserves context_length_exceeded for compaction retry', () => {
    const error = codexTerminalError({
      type: 'response.failed',
      error: {
        code: 'context_length_exceeded',
        message: 'Your input exceeds the context window of this model.',
      },
    });

    expect(error?.name).toBe('AI_APICallError');
    expect(error?.message).toContain('context_length_exceeded');
  });
});

describe('createCodexResponsesModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replays prior assistant content instead of Codex item references', async () => {
    let requestBody: any;
    vi.stubGlobal('fetch', async (_request: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'resp_test',
        created_at: Math.floor(Date.now() / 1000),
        model: 'gpt-5.4-mini',
        status: 'completed',
        output: [
          {
            id: 'msg_new',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const model = createCodexResponsesModel({
      modelId: 'gpt-5.4-mini',
      accessToken: 'token',
      baseUrl: 'https://codex.test/backend-api/codex',
    });

    await generateText({
      model,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'old answer',
              providerOptions: { openai: { itemId: 'msg_old' } },
            },
          ],
        },
        { role: 'user', content: 'follow up' },
      ],
    });

    expect(requestBody.store).toBe(false);
    expect(requestBody.input.some((item: any) => item.type === 'item_reference')).toBe(false);
    expect(requestBody.input.some((item: any) => item.role === 'assistant')).toBe(true);
  });

  it('omits max_output_tokens on Codex responses requests', async () => {
    let requestBody: any;
    vi.stubGlobal('fetch', async (_request: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'resp_test',
        created_at: Math.floor(Date.now() / 1000),
        model: 'gpt-5.4-mini',
        status: 'completed',
        output: [
          {
            id: 'msg_new',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const model = createCodexResponsesModel({
      modelId: 'gpt-5.4-mini',
      accessToken: 'token',
      baseUrl: 'https://codex.test/backend-api/codex',
    });

    await generateText({
      model,
      prompt: 'hi',
      maxOutputTokens: 321,
    });

    expect(requestBody.max_output_tokens).toBeUndefined();
  });

  it('preserves encrypted reasoning item ids but regenerates ordinary response item ids', async () => {
    let requestBody: any;
    vi.stubGlobal('fetch', async (_request: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'resp_test',
        created_at: Math.floor(Date.now() / 1000),
        model: 'gpt-5.4-mini',
        status: 'completed',
        output: [
          {
            id: 'msg_new',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const model = createCodexResponsesModel({
      modelId: 'gpt-5.4-mini',
      accessToken: 'token',
      baseUrl: 'https://codex.test/backend-api/codex',
    });

    await generateText({
      model,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'prior thinking',
              providerOptions: { openai: { itemId: 'rs_old', reasoningEncryptedContent: 'enc' } },
            },
            {
              type: 'text',
              text: 'old answer',
              providerOptions: { openai: { itemId: 'msg_old' } },
            },
          ],
        },
        { role: 'user', content: 'follow up' },
      ],
    });

    expect(requestBody.input.some((item: any) => item.id === 'rs_old')).toBe(true);
    expect(requestBody.input.some((item: any) => item.id === 'msg_old')).toBe(false);
    const replayedReasoning = requestBody.input.find((item: any) => item.type === 'reasoning');
    expect(replayedReasoning).toMatchObject({ id: 'rs_old', encrypted_content: 'enc' });
  });

  it('falls back to HTTP streaming when WebSocket never opens', async () => {
    vi.stubGlobal('fetch', async () => new Response(
      [
        'data: {"type":"response.created","response":{"id":"resp_http","created_at":1,"model":"gpt-5.4-mini"}}\n\n',
        'data: {"type":"response.output_text.delta","item_id":"msg_http","delta":"http fallback"}\n\n',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2}}}\n\n',
        'data: [DONE]\n\n',
      ].join(''),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));

    const model = createCodexResponsesModel({
      modelId: 'gpt-5.4-mini',
      accessToken: 'token',
      baseUrl: 'https://codex.test/backend-api/codex',
    });

    const result = streamText({ model, prompt: 'hi' });
    expect(await result.text).toBe('http fallback');
  });

  it('forwards reasoning settings for openai-codex like the normal openai path', async () => {
    let requestBody: any;
    vi.stubGlobal('fetch', async (_request: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: 'resp_test',
        created_at: Math.floor(Date.now() / 1000),
        model: 'gpt-5.4-mini',
        status: 'completed',
        output: [
          {
            id: 'msg_new',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const model = selectLanguageModel({
      kind: 'openai-codex',
      modelId: 'gpt-5.4-mini',
      apiKey: 'token',
      reasoningEffort: 'high',
      baseUrl: 'https://codex.test/backend-api/codex',
    });

    await generateText({
      model,
      prompt: 'hi',
    });

    expect(requestBody.reasoning).toEqual({ effort: 'high' });
  });
});
