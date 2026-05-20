import { describe, expect, it } from 'vitest';
import { extractCommitment, extractCompletion } from './commitment-service.js';

// Commitment / completion extractor regression coverage (Bet 4 +
// post-review follow-up). These regexes ship with no LLM call and
// will eventually be tuned against real channel traffic; the tests
// are the only guard against silent calibration drift.

describe('extractCommitment — positive', () => {
  it.each([
    "I'll draft the BRD",
    "I will draft the Business Requirements Document",
    "I am going to write the migration",
    "I'm going to set up the staging environment",
    'Starting now on the schema audit',
    'Beginning work on the dashboard refactor',
    'Drafting the BRD now',
    'Building the deploy pipeline',
  ])('extracts a commitment from %s', (body) => {
    const result = extractCommitment(body);
    expect(result).not.toBeNull();
    expect(result?.deliverableSummary.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('extractCommitment — negative (vacuous / non-commitments)', () => {
  it.each([
    "I'll await your reply",
    "I will wait for the file",
    "I'll be brief",
    "I'll be quick",
    "I'll note that the deploy succeeded",
    'I will say this is unusual',
    "I'll second that recommendation",
    "I will agree with the decision",
    "I'll let you know once it's ready",
    "I'll think about it",
  ])('does NOT extract from %s', (body) => {
    expect(extractCommitment(body)).toBeNull();
  });

  it('does NOT extract when the deliverable lacks a noun-ish token', () => {
    // "I'll be brief" matches the verb pattern but "brief" alone is
    // in NON_NOUN_TOKENS. The noun-ish guard kicks in.
    expect(extractCommitment("I'll do something quick.")).toBeNull();
  });

  it('does NOT extract from a body wholly inside a code fence', () => {
    expect(extractCommitment("```\nI'll draft the BRD\n```")).toBeNull();
  });

  it('does NOT extract from a fully-quoted block', () => {
    expect(extractCommitment("> I'll draft the BRD\n> Let me know")).toBeNull();
  });

  it('returns null on empty / oversize body', () => {
    expect(extractCommitment('')).toBeNull();
    expect(extractCommitment('a'.repeat(2050))).toBeNull();
  });
});

describe('extractCompletion — captures past-tense delivered work', () => {
  // The dogfood scenario that surfaced this: Layla announced
  // completed work ("I have drafted the BRD and saved it to
  // `ai/memory-bank/site-setup.md`") but the future-tense extractor
  // didn't fire, so the goals rail stayed empty. Completion
  // patterns close that gap.
  it.each([
    [
      'I have drafted the BRD based on your test results and saved it to `ai/memory-bank/site-setup.md`. It is now available for your review.',
      'ai/memory-bank/site-setup.md',
    ],
    [
      "I've created the development task list. You can find it at ai/memory-bank/tasks/google-search-verification-tasklist.md.",
      'ai/memory-bank/tasks/google-search-verification-tasklist.md',
    ],
    [
      'Saved to docs/specs/v1.md',
      'docs/specs/v1.md',
    ],
    [
      'I just finished writing the schema doc to schema.md',
      'schema.md',
    ],
  ])('extracts %s → %s', (body, expectedPath) => {
    const result = extractCompletion(body);
    expect(result).not.toBeNull();
    expect(result?.artifactPath).toBe(expectedPath);
    expect(result?.deliverableSummary).toBe(expectedPath);
  });

  it('rejects external URLs', () => {
    expect(extractCompletion('I have published it to https://example.com/spec')).toBeNull();
  });

  it('rejects absolute filesystem paths outside the workspace', () => {
    expect(extractCompletion('I have written to /etc/passwd')).toBeNull();
  });

  it('accepts /tmp/* absolute paths (sandboxed staging area)', () => {
    const result = extractCompletion('Saved to /tmp/staging-output.md');
    expect(result?.artifactPath).toBe('/tmp/staging-output.md');
  });

  it('returns null on a body with no path-shaped token', () => {
    expect(extractCompletion('I have drafted the BRD and will share it soon.')).toBeNull();
  });
});
