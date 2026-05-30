import { stepCountIs, tool, type LanguageModel } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  runAgentLoop,
  ModelNotFoundError,
  SchemaTooLargeError,
} from './agent-loop.js';

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

function reasoningThenErrorStream(errorMessage: string) {
  return simulateReadableStream({
    chunks: [
      { type: 'reasoning-start' as const, id: 'r1' },
      { type: 'reasoning-delta' as const, id: 'r1', delta: 'Thinking…' },
      { type: 'reasoning-end' as const, id: 'r1' },
      { type: 'error' as const, error: new Error(errorMessage) },
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

  it('retries when thinking-mode providers stream reasoning before rejecting toolChoice', async () => {
    const seenToolChoices: unknown[] = [];
    let calls = 0;
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        calls += 1;
        seenToolChoices.push((options as { toolChoice?: unknown }).toolChoice);
        if (calls === 1) {
          return {
            stream: reasoningThenErrorStream(
              'Thinking mode does not support this tool_choice',
            ),
          };
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
    expect(calls).toBe(2);
    expect(seenToolChoices).toEqual([{ type: 'required' }, { type: 'auto' }]);
  });

  it('classifies google "model not found" 404 as ModelNotFoundError', async () => {
    const apiError = Object.assign(new Error(
      'models/gemini-3.1-pro is not found for API version v1beta, or is not supported for generateContent.',
    ), {
      name: 'AI_APICallError',
      statusCode: 404,
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:streamGenerateContent?alt=sse',
    });
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [{ type: 'error' as const, error: apiError }],
        }),
      }),
    }) as unknown as LanguageModel;

    const promise = runAgentLoop({
      model,
      system: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      tools: {},
      stopWhen: stepCountIs(1),
      toolChoice: 'auto',
    });

    await expect(promise).rejects.toBeInstanceOf(ModelNotFoundError);
    await expect(promise).rejects.toMatchObject({
      modelId: 'gemini-3.1-pro',
      providerKindHint: 'google',
    });
  });

  it('classifies gemini "too many states" 400 as SchemaTooLargeError', async () => {
    const apiError = Object.assign(new Error(
      'The specified schema produces a constraint that has too many states for serving.',
    ), {
      name: 'AI_APICallError',
      statusCode: 400,
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    });
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [{ type: 'error' as const, error: apiError }],
        }),
      }),
    }) as unknown as LanguageModel;

    await expect(
      runAgentLoop({
        model,
        system: 'system',
        messages: [{ role: 'user', content: 'hello' }],
        tools: {},
        stopWhen: stepCountIs(1),
        toolChoice: 'auto',
      }),
    ).rejects.toBeInstanceOf(SchemaTooLargeError);
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
