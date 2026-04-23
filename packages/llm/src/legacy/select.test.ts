import { describe, expect, it } from 'vitest';
import { selectProvider } from './select';
import { LLMError } from './types';

describe('selectProvider', () => {
  it('prefers vscode-lm when provided in config', () => {
    const fake = { id: 'vscode-lm' as const, stream: async function* () { /* empty */ } };
    const provider = selectProvider({ config: { vscodeLmProvider: fake }, env: {} });
    expect(provider.id).toBe('vscode-lm');
  });

  it('falls back to anthropic when key is present', () => {
    const provider = selectProvider({ env: { ANTHROPIC_API_KEY: 'sk-test' } });
    expect(provider.id).toBe('anthropic');
  });

  it('falls through to ollama when no keys are present', () => {
    const provider = selectProvider({ env: {} });
    expect(provider.id).toBe('ollama');
  });

  it('throws when the order excludes everything configured', () => {
    expect(() => selectProvider({ order: ['anthropic'], env: {} })).toThrow(LLMError);
  });
});
