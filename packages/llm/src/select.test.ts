import { describe, expect, test } from 'vitest';
import { LLMError, selectLanguageModel } from './index';

describe('selectLanguageModel', () => {
  test('anthropic resolves without network', () => {
    const model = selectLanguageModel({
      kind: 'anthropic',
      modelId: 'claude-opus-4-7',
      apiKey: 'sk-ant-test',
    });
    expect(model).toBeDefined();
    expect(typeof model).toBe('object');
  });

  test('openai resolves without network', () => {
    const model = selectLanguageModel({
      kind: 'openai',
      modelId: 'gpt-4o-mini',
      apiKey: 'sk-test',
    });
    expect(model).toBeDefined();
  });

  test('google resolves without network', () => {
    const model = selectLanguageModel({
      kind: 'google',
      modelId: 'gemini-1.5-pro',
      apiKey: 'AIza-test',
    });
    expect(model).toBeDefined();
  });

  test('openrouter resolves via OpenAI-compatible base URL (no new SDK)', () => {
    const model = selectLanguageModel({
      kind: 'openrouter',
      modelId: 'anthropic/claude-opus-4-7',
      apiKey: 'sk-or-test',
    });
    expect(model).toBeDefined();
  });

  test('ollama resolves with no api key and default base URL', () => {
    const model = selectLanguageModel({
      kind: 'ollama',
      modelId: 'llama3.1',
    });
    expect(model).toBeDefined();
  });

  test('ollama accepts a custom base URL', () => {
    const model = selectLanguageModel({
      kind: 'ollama',
      modelId: 'llama3.1',
      baseUrl: 'http://192.168.0.10:11434/v1',
    });
    expect(model).toBeDefined();
  });

  test('anthropic/openai/google/openrouter all require apiKey', () => {
    for (const kind of [
      'anthropic',
      'openai',
      'google',
      'openrouter',
      'deepseek',
      'xai',
      'mistral',
      'kimi',
      'zhipu',
      'openai-codex',
    ] as const) {
      expect(() => selectLanguageModel({ kind, modelId: 'x' })).toThrow(LLMError);
    }
  });

  test('unsupported kind throws LLMError', () => {
    expect(() =>
      // @ts-expect-error — testing runtime guard
      selectLanguageModel({ kind: 'palm', modelId: 'x' }),
    ).toThrow(LLMError);
  });
});
