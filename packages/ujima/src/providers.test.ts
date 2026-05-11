import { describe, expect, test } from 'vitest';
import {
  ProviderConfigSchema,
  ProviderKindSchema,
  type ProviderKind,
} from './schemas.js';
import { normalizeProviders } from './providers.js';

describe('ProviderKindSchema', () => {
  test('accepts every supported kind including openrouter', () => {
    const kinds: ProviderKind[] = ['anthropic', 'openai', 'google', 'openrouter', 'ollama'];
    for (const k of kinds) {
      expect(ProviderKindSchema.parse(k)).toBe(k);
    }
  });

  test('rejects unsupported kinds', () => {
    expect(() => ProviderKindSchema.parse('palm')).toThrow();
    expect(() => ProviderKindSchema.parse('')).toThrow();
  });
});

describe('ProviderConfigSchema', () => {
  test('passes a minimal openrouter config', () => {
    const cfg = ProviderConfigSchema.parse({
      kind: 'openrouter',
      defaultModel: 'anthropic/claude-opus-4-7',
      apiKeyRef: 'OPENROUTER_API_KEY',
    });
    expect(cfg.kind).toBe('openrouter');
    expect(cfg.defaultModel).toBe('anthropic/claude-opus-4-7');
  });

  test('accepts optional baseUrl (openrouter/ollama)', () => {
    const cfg = ProviderConfigSchema.parse({
      kind: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      defaultModel: 'llama3.1',
    });
    expect(cfg.baseUrl).toBe('http://127.0.0.1:11434/v1');
  });

  test('kind is required', () => {
    expect(() =>
      ProviderConfigSchema.parse({
        apiKeyRef: 'ANTHROPIC_API_KEY',
        defaultModel: 'claude-opus-4-7',
      }),
    ).toThrow();
  });
});

describe('normalizeProviders', () => {
  test('round-trips an openrouter entry', () => {
    const out = normalizeProviders({
      openrouter: {
        kind: 'openrouter',
        apiKeyRef: 'OPENROUTER_API_KEY',
        defaultModel: 'anthropic/claude-opus-4-7',
      },
    });
    expect(out.openrouter?.kind).toBe('openrouter');
  });
});
