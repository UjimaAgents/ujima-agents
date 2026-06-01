import { stepCountIs, type LanguageModel } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
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

describe('runAgentLoop error classification', () => {
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
      }),
    ).rejects.toBeInstanceOf(SchemaTooLargeError);
  });
});

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
