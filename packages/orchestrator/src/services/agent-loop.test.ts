import { stepCountIs, type LanguageModel } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
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

describe('runAgentLoop', () => {
  it('executes the agent loop and returns the result', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        return { stream: textStream('hello') };
      },
    }) as unknown as LanguageModel;

    const result = await runAgentLoop({
      model,
      system: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
      stopWhen: stepCountIs(1),
    });

    expect(result.text).toBe('hello');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].text).toBe('hello');
  });

  it('emits streamed text deltas', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        return { stream: textStream('hello') };
      },
    }) as unknown as LanguageModel;
    const chunks: string[] = [];

    await runAgentLoop({
      model,
      system: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
      stopWhen: stepCountIs(1),
      onChunk: (chunk) => {
        if (chunk.kind === 'text') chunks.push(chunk.delta);
      },
    });

    expect(chunks).toEqual(['hello']);
  });
});
