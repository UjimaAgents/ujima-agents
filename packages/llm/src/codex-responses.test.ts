import { describe, expect, it } from 'vitest';
import { codexTerminalError, stableCodexSessionId } from './codex-responses.js';

describe('stableCodexSessionId', () => {
  it('returns a valid UUID-shaped session id', () => {
    expect(stableCodexSessionId('token', undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('codexTerminalError', () => {
  it('preserves context_length_exceeded for compaction retry', () => {
    const error = codexTerminalError({
      type: 'response.failed',
      error: {
        code: 'context_length_exceeded',
        message: 'Your input exceeds the context window of this model.',
      },
    });

    expect(error?.name).toBe('AI_APICallError');
    expect(error?.message).toContain('context_length_exceeded');
  });
});
