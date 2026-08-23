import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModel, ModelMessage } from 'ai';

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

import { streamText } from 'ai';
import {
  classifyModelError,
  ContextLengthExceededError,
  isContextLengthExceededError,
  ModelNotFoundError,
  runAgentLoop,
  SchemaTooLargeError,
} from './loop.js';

const mockStreamText = streamText as ReturnType<typeof vi.fn>;

function model(): LanguageModel {
  return {
    specificationVersion: 'v1',
    provider: 'mock',
    modelId: 'mock',
  } as unknown as LanguageModel;
}

function resolved<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('runAgentLoop interrupts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects an interrupt at the next available step before final-text termination', async () => {
    const text = resolved<string>();
    const usage = resolved<{ inputTokens: number; outputTokens: number; totalTokens: number }>();
    let preparedMessages: ModelMessage[] | undefined;

    mockStreamText.mockImplementation((options: {
      messages: ModelMessage[];
      onStepFinish: (step: unknown) => Promise<void>;
      stopWhen: (info: { steps: unknown[] }) => Promise<boolean>;
      prepareStep: (input: { stepNumber: number; messages: ModelMessage[] }) => Promise<{ messages: ModelMessage[] } | undefined>;
    }) => ({
      fullStream: {
        // This mock drives the loop entirely through the onStepFinish /
        // stopWhen / prepareStep callbacks rather than emitting stream parts,
        // so the async iterator intentionally yields nothing.
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          const firstStep = { text: 'Done.' };
          await options.onStepFinish(firstStep);
          const shouldStop = await options.stopWhen({ steps: [firstStep] });
          if (shouldStop) {
            text.resolve('Done.');
          } else {
            const prepared = await options.prepareStep({
              stepNumber: 1,
              messages: [...options.messages, { role: 'assistant', content: 'Done.' }],
            });
            preparedMessages = prepared?.messages;
            const secondStep = { text: 'Handled interrupt.' };
            await options.onStepFinish(secondStep);
            text.resolve('Handled interrupt.');
          }
          usage.resolve({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
        },
      },
      text: text.promise,
      totalUsage: usage.promise,
    }));

    const loadInterruptMessages = vi.fn(() => [
      { role: 'user' as const, content: 'Actually, include this too.' },
    ]);

    const result = await runAgentLoop({
      model: model(),
      system: 'system',
      messages: [{ role: 'user', content: 'start' }],
      tools: {},
      stopWhen: () => false,
      loadInterruptMessages,
    });

    expect(result.text).toBe('Handled interrupt.');
    expect(loadInterruptMessages).toHaveBeenCalledTimes(1);
    expect(preparedMessages).toContainEqual({
      role: 'user',
      content: 'Actually, include this too.',
    });
  });
});

describe('classifyModelError', () => {
  it('finds provider context failures through nested adapter causes', () => {
    const classified = classifyModelError({
      name: 'ClaudeCodeError',
      cause: { error: { name: 'AI_APICallError', message: 'maximum context length exceeded' } },
    });
    expect(classified).toBeInstanceOf(ContextLengthExceededError);
  });

  it('classifies OpenAI Responses failures that fold the code into the message', () => {
    const classified = classifyModelError({
      name: 'AI_APICallError',
      message: 'context_length_exceeded: too long',
    });
    expect(classified).toBeInstanceOf(ContextLengthExceededError);
  });

  it('classifies deepseek-style maximum-context-length phrasings', () => {
    const classified = classifyModelError({
      name: 'AI_APICallError',
      message: "this model's maximum context length is 128000 tokens. Please reduce the length of the messages.",
    });
    expect(classified).toBeInstanceOf(ContextLengthExceededError);
  });

  it('classifies raw provider errors by the context_length_exceeded code string', () => {
    const classified = classifyModelError({
      error: { code: 'context_length_exceeded', message: 'too long' },
    });
    expect(classified).toBeInstanceOf(ContextLengthExceededError);
  });

  it('classifies already-classified instances by name across layers', () => {
    const classified = classifyModelError({
      message: 'wrapped',
      cause: { name: 'ContextLengthExceededError', message: 'whatever happened first' },
    });
    expect(classified).toBeInstanceOf(ContextLengthExceededError);
  });

  it('classifies Gemini schema-too-large as SchemaTooLargeError', () => {
    const classified = classifyModelError({
      name: 'AI_APICallError',
      statusCode: 400,
      message: 'Request payload size exceeds the limit: too many states for serving',
    });
    expect(classified).toBeInstanceOf(SchemaTooLargeError);
  });

  it('classifies Gemini/Azure model-not-found errors as ModelNotFoundError', () => {
    const classified = classifyModelError({
      name: 'AI_APICallError',
      statusCode: 404,
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
      message: 'models/gemini-2.5-pro is not found for API version',
    });
    expect(classified).toBeInstanceOf(ModelNotFoundError);
    const notFound = classified as ModelNotFoundError;
    expect(notFound.modelId).toBe('gemini-2.5-pro');
    expect(notFound.providerKindHint).toBe('google');
  });

  it('leaves non-context provider failures unclassified', () => {
    expect(classifyModelError({ name: 'AI_APICallError', message: 'rate limit exceeded' })).toBeNull();
  });

  it('leaves aborts unclassified so they propagate unchanged', () => {
    expect(classifyModelError({ name: 'AI_AbortError', message: 'aborted' })).toBeNull();
  });
});

describe('isContextLengthExceededError', () => {
  it('is true for classified instances', () => {
    expect(isContextLengthExceededError(new ContextLengthExceededError('too long'))).toBe(true);
  });

  it('is true for raw provider context failures', () => {
    expect(
      isContextLengthExceededError({ error: { code: 'context_length_exceeded', message: 'too long' } }),
    ).toBe(true);
  });

  it('is false for unrelated errors and non-objects', () => {
    expect(isContextLengthExceededError(new Error('boom'))).toBe(false);
    expect(isContextLengthExceededError({ name: 'AI_APICallError', message: 'rate limit exceeded' })).toBe(false);
    expect(isContextLengthExceededError(null)).toBe(false);
    expect(isContextLengthExceededError('nope')).toBe(false);
  });
});

describe('runAgentLoop classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rethrows streamed provider context errors as ContextLengthExceededError', async () => {
    mockStreamText.mockImplementation(() => ({
      fullStream: {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'error',
            error: { name: 'AI_APICallError', message: 'context_length_exceeded: too long' },
          };
        },
      },
      text: new Promise(() => undefined),
      totalUsage: new Promise(() => undefined),
    }));

    await expect(
      runAgentLoop({
        model: model(),
        system: 'system',
        messages: [{ role: 'user', content: 'start' }],
        tools: {},
        stopWhen: () => false,
      }),
    ).rejects.toBeInstanceOf(ContextLengthExceededError);
  });
});
