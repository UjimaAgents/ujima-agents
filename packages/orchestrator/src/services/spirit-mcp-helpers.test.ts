import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE_TOKEN_BUDGET,
  estimateToolPaletteTokens,
} from './spirit-mcp-helpers.js';

// Two load-bearing invariants for the palette estimator:
//   1. Gemini's tokenizer is meaningfully different from Anthropic's
//      (the originating 60-tool overflow was Gemini-specific; under-
//      reporting on Gemini is the failure mode that breaks the spawn).
//   2. The default budget is pinned at 8000 — the spill priority in
//      §7.4 step 5 is calibrated against this number.

describe('estimateToolPaletteTokens — load-bearing invariants', () => {
  it('Gemini reports more tokens than Anthropic for the same palette', () => {
    const palette = {
      slack_post_message: {
        description: 'Post a message to a Slack channel',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['channel', 'text'],
        },
      },
    };
    const anthropic = estimateToolPaletteTokens(palette, 'anthropic');
    const gemini = estimateToolPaletteTokens(palette, 'gemini');
    expect(gemini).toBeGreaterThan(anthropic);
    // Empty palette = 0 tokens; rolled in here so we don't pay for a
    // separate test that only exercises the zero case.
    expect(estimateToolPaletteTokens({}, 'anthropic')).toBe(0);
  });

  it('DEFAULT_PALETTE_TOKEN_BUDGET stays pinned at 8000 (§7.4 spill calibration)', () => {
    expect(DEFAULT_PALETTE_TOKEN_BUDGET).toBe(8000);
  });
});
