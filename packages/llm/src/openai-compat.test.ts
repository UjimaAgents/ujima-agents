import { describe, expect, it } from 'vitest';
import { createOpenAICompatProvider } from './openai-compat';
import type { LLMStreamDelta } from './types';

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(iter: AsyncIterable<LLMStreamDelta>): Promise<LLMStreamDelta[]> {
  const out: LLMStreamDelta[] = [];
  for await (const d of iter) out.push(d);
  return out;
}

describe('openai-compat provider SSE parsing', () => {
  it('parses text deltas and finish_reason=stop', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    ];
    const fakeFetch: typeof fetch = async () =>
      new Response(sseStream(lines), { status: 200 });

    const provider = createOpenAICompatProvider({ apiKey: 'sk-test', fetchImpl: fakeFetch });
    const deltas = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o-mini' }),
    );
    const text = deltas.filter((d) => d.type === 'text').map((d) => (d as { text: string }).text).join('');
    expect(text).toBe('Hello world');
    const finish = deltas.find((d) => d.type === 'finish') as Extract<LLMStreamDelta, { type: 'finish' }>;
    expect(finish.reason).toBe('end_turn');
  });

  it('parses streamed tool calls with split argument chunks', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":""}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    ];
    const fakeFetch: typeof fetch = async () =>
      new Response(sseStream(lines), { status: 200 });

    const provider = createOpenAICompatProvider({ apiKey: 'sk-test', fetchImpl: fakeFetch });
    const deltas = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'read a.txt' }], model: 'gpt-4o-mini' }),
    );
    const tc = deltas.find((d) => d.type === 'tool_call');
    expect(tc).toMatchObject({ id: 'call_1', name: 'read_file', arguments: { path: 'a.txt' } });
    const finish = deltas.find((d) => d.type === 'finish') as Extract<LLMStreamDelta, { type: 'finish' }>;
    expect(finish.reason).toBe('tool_use');
  });

  it('handles [DONE] sentinel', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fakeFetch: typeof fetch = async () =>
      new Response(sseStream(lines), { status: 200 });

    const provider = createOpenAICompatProvider({ apiKey: 'sk-test', fetchImpl: fakeFetch });
    const deltas = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o-mini' }),
    );
    expect(deltas.at(-1)).toMatchObject({ type: 'finish', reason: 'end_turn' });
  });

  it('surfaces non-2xx responses as LLMError', async () => {
    const fakeFetch: typeof fetch = async () => new Response('rate limited', { status: 429 });
    const provider = createOpenAICompatProvider({ apiKey: 'sk-test', fetchImpl: fakeFetch });
    await expect(
      collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o-mini' })),
    ).rejects.toThrow(/OpenAI-compat returned 429/);
  });

  it('throws on missing API key', () => {
    expect(() => createOpenAICompatProvider({ apiKey: '' })).toThrow(/requires an API key/);
  });
});