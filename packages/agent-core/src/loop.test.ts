import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModel, ModelMessage } from 'ai';

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

import { streamText } from 'ai';
import { classifyModelError, ContextLengthExceededError, runAgentLoop } from './loop.js';

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
});
