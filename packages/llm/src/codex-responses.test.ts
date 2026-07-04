import { generateText } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexTerminalError, createCodexResponsesModel, stableCodexSessionId } from './codex-responses.js';
import { selectLanguageModel } from './select.js';

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

  it('does not reuse stored response item ids on Codex replay', async () => {
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

    expect(requestBody.input.some((item: any) => item.id === 'rs_old')).toBe(false);
    expect(requestBody.input.some((item: any) => item.id === 'msg_old')).toBe(false);
    expect(requestBody.input.some((item: any) => item.type === 'reasoning')).toBe(false);
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
