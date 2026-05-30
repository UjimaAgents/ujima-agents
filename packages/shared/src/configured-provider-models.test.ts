import { describe, expect, it } from 'vitest';
import { listConfiguredProviderModels } from './configured-provider-models.js';

describe('listConfiguredProviderModels', () => {
  it('excludes providers without keys', () => {
    const options = listConfiguredProviderModels([
      { name: 'openai', hasKey: true },
      { name: 'anthropic', hasKey: false },
    ]);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.provider === 'openai')).toBe(true);
  });
});
