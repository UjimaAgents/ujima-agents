import { describe, expect, it, vi } from 'vitest';
import { createMockProvider, textTurn, toolTurn } from './mock';
import type { LLMStreamDelta } from './types';

async function collect(iter: AsyncIterable<LLMStreamDelta>): Promise<LLMStreamDelta[]> {
  const out: LLMStreamDelta[] = [];
  for await (const d of iter) out.push(d);
  return out;
}

describe('mock LLM provider', () => {
  it('plays a single text turn', async () => {
    const provider = createMockProvider({ script: [textTurn('hello world')] });
    const deltas = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'mock' }),
    );
    expect(deltas).toEqual([
      { type: 'text', text: 'hello world' },
      { type: 'finish', reason: 'end_turn' },
    ]);
  });

  it('advances turn index on each call and yields tool_use finish', async () => {
    const onCall = vi.fn();
    const provider = createMockProvider({
      script: [
        toolTurn('call_1', 'echo', { msg: 'hi' }, 'calling echo'),
        textTurn('done'),
      ],
      onCall,
    });
    const first = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'mock' }),
    );
    expect(first.find((d) => d.type === 'tool_call')).toMatchObject({ name: 'echo', id: 'call_1' });
    expect(first.find((d) => d.type === 'finish')).toMatchObject({ reason: 'tool_use' });

    const second = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'continue' }], model: 'mock' }),
    );
    expect(second[0]).toEqual({ type: 'text', text: 'done' });
    expect(onCall).toHaveBeenCalledTimes(2);
  });

  it('defaults to a finish delta when the script is exhausted', async () => {
    const provider = createMockProvider({ script: [] });
    const deltas = await collect(
      provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'mock' }),
    );
    expect(deltas).toEqual([{ type: 'finish', reason: 'end_turn' }]);
  });
});
