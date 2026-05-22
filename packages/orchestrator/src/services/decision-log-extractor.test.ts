import { describe, expect, it } from 'vitest';
import { extractDecision } from './commitment-service.js';

// Bet 6 — append-only decision log. The extractor lives in
// commitment-service.ts because it runs alongside commitment
// extraction on the same publish hook. These tests cover the
// lexical pattern: positive matches on declarative "we should X"
// and "let's use Y", negative matches on vacuous lines and code
// fences, length floor for noise rejection.

describe('extractDecision — positive matches', () => {
  it.each([
    "We should ship the Postgres migration before the freeze.",
    "Let's use SQLite for now; we can revisit when the corpus grows.",
    "Decision: we will keep the channel-9ufz1jk3 commitments expired.",
    "We must remove the old auth middleware before Friday's release.",
    "We won't rename the schema migration files this sprint.",
    "Going to use bm25 over embeddings until empty-result rate exceeds 25%.",
    "We'll prefer the regex extractor over an LLM summariser in the hot path.",
  ])('extracts: %s', (line) => {
    const result = extractDecision(line);
    expect(result).not.toBeNull();
    expect(result?.length).toBeGreaterThanOrEqual(24);
  });

  it('strips leading @mention noise from the captured decision', () => {
    const result = extractDecision(
      "@Phoebe Parker, we should keep the regex extractor in the hot path.",
    );
    expect(result).toBe('we should keep the regex extractor in the hot path.');
  });
});

describe('extractDecision — negative matches', () => {
  it('rejects lines shorter than the minimum', () => {
    expect(extractDecision('we should')).toBeNull();
    expect(extractDecision('use it')).toBeNull();
  });

  it('rejects fenced code blocks', () => {
    expect(extractDecision('```\nlet x = 1;\nwe will use x later\n```')).toBeNull();
  });

  it('rejects fully-quoted bodies', () => {
    expect(
      extractDecision('> we should ship the Postgres migration before the freeze.'),
    ).toBeNull();
  });

  it('rejects empty / oversize bodies', () => {
    expect(extractDecision('')).toBeNull();
    expect(extractDecision('a'.repeat(5000))).toBeNull();
  });

  it('rejects vacuous keyword-free lines', () => {
    expect(extractDecision('I am still reading the BRD before I respond properly.')).toBeNull();
  });
});

describe('extractDecision — multi-line bodies', () => {
  it('picks the FIRST decision-shaped line when multiple are present', () => {
    const body = [
      'Looking at the migration plan now.',
      'We should use Postgres for the production cluster.',
      'Decision two: we will keep SQLite for dev.',
    ].join('\n');
    const result = extractDecision(body);
    // First match wins — the order is "Looking at the migration..."
    // (rejected — no keyword) → "We should use Postgres..." (match).
    expect(result).toBe('We should use Postgres for the production cluster.');
  });
});
