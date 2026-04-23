import { describe, expect, it } from 'vitest';
import { createOllamaProvider } from './ollama';
import type { LLMStreamDelta } from './types';

function ndjsonStream(objects: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const obj of objects) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      }
      controller.close();
    },
  });
}

async function collect(iter: AsyncIterable<LLMStreamDelta>): Promise<LLMStreamDelta[]> {
  const out: LLMStreamDelta[] = [];
  for await (const d of iter) out.push(d);
  return out;
}

describe('ollama provider NDJSON parsing', () => {
  it('parses text chunks and final done=true with usage', async () => {
    const chunks = [
      { message: { content: 'Hello ' }, done: false },
      { message: { content: 'world' }, done: false },
      { done: true, prompt_eval_count: 12, eval_count: 8 },
    ];
    const fakeFetch: typeof fetch = async () =>
      new Response(ndjsonStream(chunks), { status: 200 });

    const provider = createOllamaProvider({ fetchImpl: fakeFetch });
    const deltas = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'llama3' }),
    );
    const text = deltas.filter((d) => d.type === 'text').map((d) => (d as { text: string }).text).join('');
    expect(text).toBe('Hello world');
    const finish = deltas.find((d) => d.type === 'finish') as Extract<LLMStreamDelta, { type: 'finish' }>;
    expect(finish.reason).toBe('end_turn');
    expect(finish.usage).toEqual({ inputTokens: 12, outputTokens: 8 });
  });

  it('parses tool calls from a single chunk', async () => {
    const chunks = [
      {
        message: {
          content: '',
          tool_calls: [
            { id: 'tc_1', function: { name: 'list_tables', arguments: { schema: 'public' } } },
          ],
        },
        done: false,
      },
      { done: true, prompt_eval_count: 5, eval_count: 3 },
    ];
    const fakeFetch: typeof fetch = async () =>
      new Response(ndjsonStream(chunks), { status: 200 });

    const provider = createOllamaProvider({ fetchImpl: fakeFetch });
    const deltas = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'list tables' }], model: 'llama3' }),
    );
    const tc = deltas.find((d) => d.type === 'tool_call');
    expect(tc).toMatchObject({ id: 'tc_1', name: 'list_tables', arguments: { schema: 'public' } });
  });

  it('generates synthetic id when tool call has no id', async () => {
    const chunks = [
      {
        message: {
          tool_calls: [{ function: { name: 'echo', arguments: { msg: 'hi' } } }],
        },
        done: false,
      },
      { done: true },
    ];
    const fakeFetch: typeof fetch = async () =>
      new Response(ndjsonStream(chunks), { status: 200 });

    const provider = createOllamaProvider({ fetchImpl: fakeFetch });
    const deltas = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'echo' }], model: 'llama3' }),
    );
    const tc = deltas.find((d) => d.type === 'tool_call') as Extract<LLMStreamDelta, { type: 'tool_call' }>;
    expect(tc.name).toBe('echo');
    expect(tc.id).toMatch(/^tc_/);
  });

  it('surfaces non-2xx responses as LLMError', async () => {
    const fakeFetch: typeof fetch = async () => new Response('model not found', { status: 404 });
    const provider = createOllamaProvider({ fetchImpl: fakeFetch });
    await expect(
      collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'nope' })),
    ).rejects.toThrow(/Ollama returned 404/);
  });

  it('yields finish even if stream ends without done=true', async () => {
    const chunks = [
      { message: { content: 'partial' }, done: false },
    ];
    const fakeFetch: typeof fetch = async () =>
      new Response(ndjsonStream(chunks), { status: 200 });

    const provider = createOllamaProvider({ fetchImpl: fakeFetch });
    const deltas = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'llama3' }),
    );
    expect(deltas.at(-1)).toMatchObject({ type: 'finish', reason: 'end_turn' });
  });
});