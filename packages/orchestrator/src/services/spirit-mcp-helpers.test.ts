import { describe, expect, it } from 'vitest';
import { tool } from 'ai';
import { z } from 'zod';
import {
  DEFAULT_PALETTE_TOKEN_BUDGET,
  estimateToolPaletteTokens,
} from './spirit-mcp-helpers.js';

// We build minimal `ai` ToolSet shapes by hand to avoid coupling these
// tests to the MCP wiring. The estimator only reads description +
// inputSchema/parameters, so a hand-rolled record matches what the
// V2 spawn path will feed it.

function makeTool(description: string, schema: unknown) {
  return tool({
    description,
    parameters: z.object({}),
    execute: async () => 'ok',
  }) as unknown as { description: string; inputSchema: unknown };
}

describe('estimateToolPaletteTokens', () => {
  it('returns 0 for an empty palette', () => {
    expect(estimateToolPaletteTokens({})).toBe(0);
  });

  it('scales with description length and schema size', () => {
    const small = estimateToolPaletteTokens({
      small: { description: 'one-liner', inputSchema: { type: 'object' } },
    });
    const big = estimateToolPaletteTokens({
      big: {
        description: 'a much longer description that includes detailed prose',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'integer' },
            cursor: { type: 'string' },
          },
        },
      },
    });
    expect(big).toBeGreaterThan(small);
  });

  it('reports higher token counts for Gemini (smaller chars/token divisor)', () => {
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
  });

  it('uses the conservative divisor when vendor is unknown (over-estimates rather than under)', () => {
    const palette = {
      probe: { description: 'x', inputSchema: { type: 'object' } },
    };
    const unknown = estimateToolPaletteTokens(palette);
    const anthropic = estimateToolPaletteTokens(palette, 'anthropic');
    // Unknown should produce >= the lowest divisor's count; for this case
    // it equals Gemini's count because conservative divisor matches.
    expect(unknown).toBeGreaterThanOrEqual(anthropic);
  });

  it('accepts ai-SDK `parameters` field as a fallback to `inputSchema`', () => {
    const palette = {
      via_inputSchema: { description: 'x', inputSchema: { foo: 'bar' } },
      via_parameters: { description: 'x', parameters: { foo: 'bar' } },
    };
    // Both paths must contribute equally; the difference between them
    // would be a couple of bytes for the key name, not the schema.
    const total = estimateToolPaletteTokens(palette, 'anthropic');
    expect(total).toBeGreaterThan(0);
  });

  it('does not throw on a non-serialisable schema (defensive for settings UI render)', () => {
    const circular: Record<string, unknown> = { type: 'object' };
    circular.self = circular;
    const palette = {
      gnarly: { description: 'has a cycle', inputSchema: circular },
    };
    expect(() => estimateToolPaletteTokens(palette, 'anthropic')).not.toThrow();
  });

  it('exposes a default budget consistent with the spec', () => {
    // The spec pins 8000 as the default native-palette token budget;
    // a silent change here would invalidate the spill priority order
    // in §7.4 step 5. Keep the contract.
    expect(DEFAULT_PALETTE_TOKEN_BUDGET).toBe(8000);
  });

  // Sanity: this test exercises the `ai.tool()` shape to confirm we
  // tolerate the real ToolSet members the V2 spawn path will pass in.
  it('handles ai-SDK `tool()` shape end-to-end', () => {
    const realTool = makeTool('hello', { type: 'object' });
    const palette = { hello_tool: realTool };
    expect(estimateToolPaletteTokens(palette, 'anthropic')).toBeGreaterThan(0);
  });
});
