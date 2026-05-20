import { stepCountIs, tool, type LanguageModel } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runAgentLoop } from './agent-loop.js';

function v3Usage(inputTotal: number, outputTotal: number) {
  return {
    inputTokens: { total: inputTotal, noCache: inputTotal, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTotal, text: outputTotal, reasoning: 0 },
    totalTokens: inputTotal + outputTotal,
  };
}

function textStream(text: string) {
  return simulateReadableStream({
    chunks: [
      { type: 'text-start' as const, id: '1' },
      { type: 'text-delta' as const, id: '1', delta: text },
      { type: 'text-end' as const, id: '1' },
      {
        type: 'finish' as const,
        usage: v3Usage(3, 2),
        finishReason: { unified: 'stop' as const, raw: 'stop' },
      },
    ],
  });
}

describe('runAgentLoop toolChoice fallback', () => {
  it('retries without required first-step toolChoice when the provider rejects it', async () => {
    const seenToolChoices: unknown[] = [];
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        seenToolChoices.push((options as { toolChoice?: unknown }).toolChoice);
        if (seenToolChoices.length === 1) {
          throw new Error('deepseek-reasoner does not support this tool_choice');
        }
        return { stream: textStream('ok') };
      },
    }) as unknown as LanguageModel;

    const result = await runAgentLoop({
      model,
      system: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      tools: {
        noop: tool({
          description: 'No-op',
          inputSchema: z.object({}),
          execute: async () => ({ ok: true }),
        }),
      },
      stopWhen: stepCountIs(1),
      toolChoice: 'required-first-step',
    });

    expect(result.text).toBe('ok');
    expect(seenToolChoices).toEqual([{ type: 'required' }, { type: 'auto' }]);
  });

  it('does not retry unrelated provider errors', async () => {
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        calls += 1;
        throw new Error('provider unavailable');
      },
    }) as unknown as LanguageModel;

    await expect(
      runAgentLoop({
        model,
        system: 'system',
        messages: [{ role: 'user', content: 'hello' }],
        tools: {},
        stopWhen: stepCountIs(1),
        toolChoice: 'required-first-step',
      }),
    ).rejects.toThrow('provider unavailable');
    expect(calls).toBe(1);
  });
});
