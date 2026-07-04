import { describe, expect, it } from 'vitest';
import {
  isOpenAIResponsesDoneEvent,
  openAIResponsesTerminalError,
  prepareOpenAIResponsesRequest,
  shouldUseOpenAIResponsesSocket,
  stripOpenAIResponsesTransportFields,
} from './openai-responses.js';

describe('prepareOpenAIResponsesRequest', () => {
  it('preserves JSON request bodies exactly', async () => {
    const request = new Request('https://codex.test/backend-api/codex/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-5.4-mini', max_output_tokens: 123 }),
      headers: { 'content-type': 'application/json' },
    });

    const prepared = await prepareOpenAIResponsesRequest(request, undefined);
    expect(await (prepared.request as Request).text()).toBe(JSON.stringify({ model: 'gpt-5.4-mini', max_output_tokens: 123 }));
  });
});

describe('shouldUseOpenAIResponsesSocket', () => {
  it('recognizes streaming responses requests and preserves request body fields', () => {
    const body = JSON.stringify({
      model: 'gpt-5.4-mini',
      stream: true,
      max_output_tokens: 321,
      reasoning: { effort: 'high' },
    });

    const target = shouldUseOpenAIResponsesSocket(
      'https://codex.test/backend-api/codex/responses',
      { method: 'POST', body },
    );

    expect(target?.url.toString()).toBe('https://codex.test/backend-api/codex/responses');
    expect(target?.body.max_output_tokens).toBe(321);
    expect(target?.body.reasoning).toEqual({ effort: 'high' });
  });

  it('rejects non-streaming requests', () => {
    const target = shouldUseOpenAIResponsesSocket(
      'https://codex.test/backend-api/codex/responses',
      { method: 'POST', body: JSON.stringify({ stream: false }) },
    );

    expect(target).toBeNull();
  });
});

describe('stripOpenAIResponsesTransportFields', () => {
  it('drops transport-only fields and keeps payload fields', () => {
    expect(stripOpenAIResponsesTransportFields({
      stream: true,
      background: true,
      model: 'gpt-5.4-mini',
      max_output_tokens: 200,
    })).toEqual({
      model: 'gpt-5.4-mini',
      max_output_tokens: 200,
    });
  });
});

describe('responses events', () => {
  it('maps terminal errors', () => {
    const error = openAIResponsesTerminalError({
      type: 'response.failed',
      error: { code: 'context_length_exceeded', message: 'too long' },
    });

    expect(error?.name).toBe('AI_APICallError');
    expect(error?.message).toBe('context_length_exceeded: too long');
  });

  it('recognizes done events', () => {
    expect(isOpenAIResponsesDoneEvent({ type: 'response.completed' })).toBe(true);
    expect(isOpenAIResponsesDoneEvent({ type: 'response.done' })).toBe(true);
    expect(isOpenAIResponsesDoneEvent({ type: 'response.created' })).toBe(false);
  });
});
