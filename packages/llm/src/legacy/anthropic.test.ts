import { describe, expect, it } from 'vitest';
import { createAnthropicProvider } from './anthropic';
import type { LLMStreamDelta } from './types';

function sseStream(events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(encoder.encode(`event: ${(evt as { type: string }).type}\ndata: ${JSON.stringify(evt)}\n\n`));
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

describe('anthropic provider SSE parsing', () => {
  it('parses text and tool_use events', async () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'echo' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"msg":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"hi"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', index: 0, delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 10, output_tokens: 5 } },
      { type: 'message_stop', index: 0 },
    ];
    const fakeFetch: typeof fetch = async () =>
      new Response(sseStream(events), { status: 200, headers: { 'content-type': 'text/event-stream' } });

    const provider = createAnthropicProvider({ apiKey: 'sk-test', fetchImpl: fakeFetch });
    const deltas = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'claude-3' }),
    );
    expect(deltas.filter((d) => d.type === 'text').map((d) => (d as { text: string }).text).join('')).toBe('Hello world');
    const toolCall = deltas.find((d) => d.type === 'tool_call');
    expect(toolCall).toMatchObject({ id: 'tu_1', name: 'echo', arguments: { msg: 'hi' } });
    const finish = deltas.find((d) => d.type === 'finish') as Extract<LLMStreamDelta, { type: 'finish' }>;
    expect(finish.reason).toBe('tool_use');
    expect(finish.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('surfaces non-2xx responses as LLMError', async () => {
    const fakeFetch: typeof fetch = async () => new Response('boom', { status: 500 });
    const provider = createAnthropicProvider({ apiKey: 'sk-test', fetchImpl: fakeFetch });
    await expect(
      collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'claude-3' })),
    ).rejects.toThrow(/Anthropic returned 500/);
  });
});
