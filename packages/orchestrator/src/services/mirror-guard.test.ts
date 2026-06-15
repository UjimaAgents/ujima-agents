import { describe, expect, it } from 'vitest';
import {
  detectMirrorChain,
  isVacuousAck,
  shouldSuppressForMirror,
} from './mirror-guard.js';

// Mirror-loop guard regression coverage (Bet 1.5 follow-up). These
// helpers ship with no LLM call and are pure functions, so the unit
// tests are the only signal we have that calibration changes don't
// silently de-tune the guard.

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

});

describe('detectMirrorChain', () => {
  const makeMessage = (senderId: string, content: string) => ({ senderId, content });

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

});

describe('shouldSuppressForMirror', () => {
  // Combines the vacuous-ack predicate with the chain detector —
  // suppress=true only when both fire. Either alone is insufficient.
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
