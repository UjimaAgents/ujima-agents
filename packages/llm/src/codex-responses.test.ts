import { describe, expect, it } from 'vitest';
import { stableCodexSessionId } from './codex-responses.js';

describe('stableCodexSessionId', () => {
  it('returns a valid UUID-shaped session id', () => {
    expect(stableCodexSessionId('token', undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
