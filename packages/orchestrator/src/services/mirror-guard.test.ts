import { describe, expect, it } from 'vitest';
import {
  detectMirrorChain,
  isMirrorFragileModel,
  isVacuousAck,
  shouldSuppressForMirror,
} from './mirror-guard.js';

// Mirror-loop guard regression coverage (Bet 1.5 follow-up). These
// helpers ship with no LLM call and are pure functions, so the unit
// tests are the only signal we have that calibration changes don't
// silently de-tune the guard.

describe('isMirrorFragileModel', () => {
  it.each([
    'gemini-2.5-flash',
    'GEMINI-2.5-FLASH',
    'google/gemini-2.5-flash',
    'vertex-gemini-flash-001',
    'models/gemini-1.5-flash-002',
    'gemini-2.5-flash-lite-preview',
  ])('matches fragile id %s', (id) => {
    expect(isMirrorFragileModel(id)).toBe(true);
  });

  it.each([
    'claude-opus-4-7',
    'gpt-5.4',
    'gemini-2.5-pro',
    'deepseek-v4-flash', // not a gemini family
    '',
  ])('does NOT match non-fragile id %s', (id) => {
    expect(isMirrorFragileModel(id)).toBe(false);
  });
});

describe('isVacuousAck', () => {
  it.each([
    'Understood',
    'Understood.',
    'Acknowledged',
    'Got it.',
    "I'll await your reply",
    'Will do.',
    'Noted.',
    'Thanks.',
  ])('classifies %s as vacuous', (body) => {
    expect(isVacuousAck(body)).toBe(true);
  });

  // QA-flagged regression: a reply that OPENS with "Got it" but
  // carries substantive payload must NOT be classified as vacuous.
  // Otherwise the parent-mention is dropped at the fanout layer and
  // the substantive content goes unanswered.
  it.each([
    "Got it. Sending the file now: /tmp/spec.pdf",
    'Understood, the issue is the missing migration in 022. Will reproduce locally.',
    'Got it — drafting the BRD with the changes you flagged and the new schema.',
    'Thanks for the heads-up; running the script against staging now to verify the rollout.',
  ])('does NOT classify substantive body %s as vacuous', (body) => {
    expect(isVacuousAck(body)).toBe(false);
  });

  it('does NOT classify a body containing a question mark as vacuous', () => {
    expect(isVacuousAck('Understood. Could you also share the schema?')).toBe(false);
  });

  it('does NOT classify a body containing a URL as vacuous', () => {
    expect(isVacuousAck('Got it. See https://example.com/spec.pdf')).toBe(false);
  });

  it('returns false for an empty or oversized body', () => {
    expect(isVacuousAck('')).toBe(false);
    expect(isVacuousAck('Understood. ' + 'x'.repeat(250))).toBe(false);
  });
});

describe('detectMirrorChain', () => {
  const makeMessage = (senderId: string, content: string) => ({ senderId, content });

  it('requires at least windowSize messages — returns false on a short window', () => {
    const result = detectMirrorChain({
      candidateBody: 'Understood, I will await your reply.',
      recentAgentMessages: [makeMessage('a', 'Understood, I will await your reply.')],
      selfMemberId: 'a',
    });
    expect(result.triggered).toBe(false);
  });

  it('returns false on empty candidate body', () => {
    const result = detectMirrorChain({
      candidateBody: '',
      recentAgentMessages: [
        makeMessage('a', 'Understood, I will await your reply.'),
        makeMessage('b', 'Understood, I will await your reply.'),
        makeMessage('a', 'Understood, I will await your reply.'),
      ],
      selfMemberId: 'a',
    });
    expect(result.triggered).toBe(false);
  });

  it('trips on a three-turn pair-mirror chain of vacuous acks', () => {
    // Real failure mode: gemini-flash produces near-identical
    // templated acks. The chain qualifies because every message —
    // including the candidate — classifies as vacuous (no path, no
    // numeric id, no substantive action verb).
    const chained = [
      'Understood, I will continue to await your reply.',
      'Understood, I will continue to await your reply.',
      'Understood, I will continue to await your reply.',
    ];
    const result = detectMirrorChain({
      candidateBody: 'Understood, I will continue to await your reply.',
      recentAgentMessages: [
        makeMessage('a', chained[0]!),
        makeMessage('b', chained[1]!),
        makeMessage('a', chained[2]!),
      ],
      selfMemberId: 'b',
    });
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe('pair-mirror');
  });

  it('does NOT trip when the candidate carries substantive new content', () => {
    const chained = [
      'Understood, I will continue to await your reply.',
      'Understood, I will continue to await your reply.',
      'Understood, I will continue to await your reply.',
    ];
    const result = detectMirrorChain({
      candidateBody:
        "Here's the draft, the schema diff is in /tmp/schema.md and tests are passing for the new migration path.",
      recentAgentMessages: [
        makeMessage('a', chained[0]!),
        makeMessage('b', chained[1]!),
        makeMessage('a', chained[2]!),
      ],
      selfMemberId: 'b',
    });
    expect(result.triggered).toBe(false);
  });

  it('does NOT trip when the candidate is too short to be meaningful', () => {
    const result = detectMirrorChain({
      candidateBody: 'ok',
      recentAgentMessages: [
        makeMessage('a', 'Understood, I will await your reply on the BRD.'),
        makeMessage('b', 'Understood, I will await your reply on the BRD.'),
        makeMessage('a', 'Understood, I will await your reply on the BRD.'),
      ],
      selfMemberId: 'b',
    });
    expect(result.triggered).toBe(false);
  });
});

describe('shouldSuppressForMirror', () => {
  // Combines the vacuous-ack predicate with the chain detector —
  // suppress=true only when both fire. Either alone is insufficient.
  it('does NOT suppress a non-vacuous body, even if it tokens-overlap the chain', () => {
    const chained = [
      'Understood, I will continue to await the BRD.',
      'Understood, I am still working on the BRD.',
      'Understood, I will continue to await the BRD.',
    ];
    const result = shouldSuppressForMirror({
      candidateBody:
        'The BRD is now ready: see /tmp/brd.md. Functional requirements are clearly identified.',
      recentAgentMessages: [
        { senderId: 'a', content: chained[0]! },
        { senderId: 'b', content: chained[1]! },
        { senderId: 'a', content: chained[2]! },
      ],
      selfMemberId: 'b',
    });
    expect(result.suppress).toBe(false);
  });

  it('suppresses a vacuous body inside a real mirror chain', () => {
    const chained = [
      'Understood, I will continue to await your reply.',
      'Understood, I will continue to await your reply.',
      'Understood, I will continue to await your reply.',
    ];
    const result = shouldSuppressForMirror({
      candidateBody: 'Understood, I will continue to await your reply.',
      recentAgentMessages: [
        { senderId: 'a', content: chained[0]! },
        { senderId: 'b', content: chained[1]! },
        { senderId: 'a', content: chained[2]! },
      ],
      selfMemberId: 'b',
    });
    expect(result.suppress).toBe(true);
    expect(result.reason).toBe('pair-mirror');
  });
});
