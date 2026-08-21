import { describe, expect, test } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { ModelMessage, ToolSet } from 'ai';
import { ContextLengthExceededError } from '@ujima/agent-core';
import { runAgentLoopWithRetry } from './loop-host';

function successParts(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: 'text-start', id: '1' },
    { type: 'text-delta', id: '1', delta: text },
    { type: 'text-end', id: '1' },
    {
      type: 'finish',
      usage: {
        inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 2, text: 2, reasoning: 0 },
      },
      finishReason: { unified: 'stop', raw: 'stop' },
    } as unknown as LanguageModelV3StreamPart,
  ];
}

function makeModel(parts: (prompt: ModelMessage[]) => LanguageModelV3StreamPart[]) {
  return new MockLanguageModelV3({
    doStream: async (options) => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: parts(options.prompt as ModelMessage[]),
      }),
    }),
  });
}

/** Model whose first prompt round fails with the given error, then succeeds. */
function makeCompactingModel(
  failure: Error | Record<string, unknown>,
  detectFullContext: (prompt: ModelMessage[]) => boolean,
) {
  return new MockLanguageModelV3({
    doStream: async (options) => {
      const prompt = options.prompt as ModelMessage[];
      if (detectFullContext(prompt)) throw failure;
      return {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: successParts('ok'),
        }),
      };
    },
  });
}

function baseArgs(model: ReturnType<typeof makeModel>, messages: ModelMessage[]) {
  return () => ({
    model,
    system: 'sys',
    messages,
    tools: {} as ToolSet,
    stopWhen: () => false,
  });
}

function flattenContent(m: ModelMessage): string {
  if (typeof m.content === 'string') return m.content;
  return m.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
}

function promptHasText(prompt: ModelMessage[], text: string): boolean {
  return prompt.some(
    (m) =>
      m.content === text ||
      (Array.isArray(m.content) && m.content.some((c) => c.type === 'text' && c.text === text)),
  );
}

describe('runAgentLoopWithRetry', () => {
  test('passes through a clean run without invoking the compaction hook', async () => {
    const model = makeModel(() => successParts('done'));
    const hook = { onContextLengthExceeded: () => { throw new Error('hook must not run'); } };

    const result = await runAgentLoopWithRetry(
      baseArgs(model, [{ role: 'user', content: 'hi' }]),
      hook,
    );

    expect(result.text).toBe('done');
  });

  test('compacts once with the hook-reduced messages, then succeeds', async () => {
    const attempts: ModelMessage[][] = [];
    const model = makeCompactingModel(
      new ContextLengthExceededError('too long'),
      (prompt) => {
        attempts.push(prompt);
        return promptHasText(prompt, '[zone-2 context]');
      },
    );
    let hookRuns = 0;
    let messages: ModelMessage[] = [{ role: 'user', content: '[zone-2 context]' }];

    const result = await runAgentLoopWithRetry(
      () => ({ model, system: 'sys', messages, tools: {} as ToolSet, stopWhen: () => false }),
      {
        onContextLengthExceeded: async () => {
          hookRuns++;
          messages = [
            { role: 'user', content: '<wake-context>ctx</wake-context>' },
            { role: 'user', content: 'task prompt' },
          ];
          return messages;
        },
      },
    );

    expect(result.text).toBe('ok');
    expect(hookRuns).toBe(1);
    expect(attempts).toHaveLength(2);
    // The SDK prepends the system message to the model prompt.
    expect(attempts[1]?.slice(1).map(flattenContent)).toEqual([
      '<wake-context>ctx</wake-context>',
      'task prompt',
    ]);
  });

  test('retries exactly once, then surfaces a second context-length failure', async () => {
    let hookRuns = 0;
    const model = makeCompactingModel(new ContextLengthExceededError('still too long'), () => true);

    await expect(
      runAgentLoopWithRetry(baseArgs(model, [{ role: 'user', content: 'hi' }]), {
        onContextLengthExceeded: async () => {
          hookRuns++;
          return [{ role: 'user', content: 'shorter' }];
        },
      }),
    ).rejects.toBeInstanceOf(ContextLengthExceededError);

    expect(hookRuns).toBe(1);
  });

  test('classifies opaque provider error shapes and still fires the hook', async () => {
    let hookRuns = 0;
    const model = makeCompactingModel(
      {
        name: 'AI_APICallError',
        message:
          "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens. Please reduce the length of the messages.",
      },
      () => true,
    );

    let hookError: unknown;
    await expect(
      runAgentLoopWithRetry(baseArgs(model, [{ role: 'user', content: 'hi' }]), {
        onContextLengthExceeded: async (error) => {
          hookRuns++;
          hookError = error;
          return null;
        },
      }),
    ).rejects.toBeInstanceOf(ContextLengthExceededError);

    expect(hookRuns).toBe(1);
    expect(hookError).toBeInstanceOf(ContextLengthExceededError);
  });
});