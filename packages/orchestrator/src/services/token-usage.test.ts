import { describe, expect, it } from 'vitest';
import { normalizeStepTokenUsage } from './token-usage.js';

describe('normalizeStepTokenUsage', () => {
  it('uses the latest input window and accumulates output', () => {
    expect(
      normalizeStepTokenUsage([
        { usage: { inputTokens: 900_000, outputTokens: 100 } },
        { usage: { inputTokens: 910_000, outputTokens: 200 } },
        { usage: { inputTokens: 920_000, outputTokens: 300 } },
      ]),
    ).toEqual({
      inputTokens: 920_000,
      outputTokens: 600,
      totalTokens: 920_600,
    });
  });
});
