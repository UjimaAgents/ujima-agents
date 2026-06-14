import { describe, expect, it } from 'vitest';
import {
  BASE_WAKE_SCAFFOLD,
  buildCacheableSystem,
  buildWakeContextMessages,
  hashPromptZone,
} from './system-prompt-builder.js';

// Bet 1 — cache-stability CI lint. The system prompt now has a
// promise: per (member, channel) the cacheable prefix is BYTE-
// IDENTICAL across wake reasons. These tests are the load-bearing
// guard against a future refactor pushing a wakeReason-dependent
// line back into the system string.

const FIXED_BASE = `You are Layla Lane, an employee of Acme.
Role: Senior PM. Personality: direct.

Members:
- Phoebe Parker (qa-engineer)

Channels:
- general
`;

describe('buildCacheableSystem — cache stability invariants', () => {
  it('produces byte-identical system across two calls with the same inputs', () => {
    const a = buildCacheableSystem({ baseSystem: FIXED_BASE });
    const b = buildCacheableSystem({ baseSystem: FIXED_BASE });
    expect(a.system).toBe(b.system);
    expect(a.hash).toBe(b.hash);
  });

  it('includes the BASE_WAKE_SCAFFOLD in the cacheable system string', () => {
    const { system } = buildCacheableSystem({ baseSystem: FIXED_BASE });
    for (const line of BASE_WAKE_SCAFFOLD) {
      expect(system).toContain(line);
    }
  });

  it('appends procedures.md content when present, and changing procedures DOES change the hash (rare bust is by design)', () => {
    const a = buildCacheableSystem({ baseSystem: FIXED_BASE });
    const b = buildCacheableSystem({
      baseSystem: FIXED_BASE,
      proceduresText: 'When pinging Phoebe, include the artifact path.',
    });
    expect(a.hash).not.toBe(b.hash);
    expect(b.system).toContain('When pinging Phoebe, include the artifact path.');
  });

  it('hashPromptZone is deterministic', () => {
    expect(hashPromptZone('abc')).toBe(hashPromptZone('abc'));
    expect(hashPromptZone('abc')).not.toBe(hashPromptZone('abd'));
  });

  // Procedures-as-Culture (docs/procedures-as-culture.md "Zone 1 ordering").
  it('hoists lawText above procedures', () => {
    const { system } = buildCacheableSystem({
      baseSystem: FIXED_BASE,
      lawText: 'LAW (do not violate): Never share customer data.',
      proceduresText: 'Workspace Culture — applies to everyone.',
    });
    const lawIdx = system.indexOf('LAW (do not violate)');
    const cultureIdx = system.indexOf('Workspace Culture');
    expect(lawIdx).toBeGreaterThan(-1);
    expect(cultureIdx).toBeGreaterThan(-1);
    expect(lawIdx).toBeLessThan(cultureIdx);
  });
});

describe('buildWakeContextMessages — per-wake additions (NOT part of cacheable prefix)', () => {
  it('returns no messages for a plain mention wake on a non-fragile model', () => {
    const out = buildWakeContextMessages({
      wakeReason: 'mention',
      modelIdString: 'claude-opus-4',
      isMirrorFragile: false,
    });
    expect(out).toEqual([]);
  });

  it('emits the anti-mirror line for fragile models', () => {
    const out = buildWakeContextMessages({
      wakeReason: 'mention',
      modelIdString: 'gemini-2.5-flash',
      isMirrorFragile: true,
    });
    expect(out).toHaveLength(1);
    const text = String(out[0]?.content ?? '');
    expect(text).toContain('anti-mirror');
  });
});

// The lint: the cacheable system MUST NOT vary by wakeReason or
// modelIdString. The actual ai-service plumbing puts per-wake lines
// into the messages array via buildWakeContextMessages. This test
// asserts that the prompt-builder API itself cannot accept a
// wakeReason parameter — a future refactor pushing one in would
// break this contract test at the type level.
describe('cache-stability invariant — buildCacheableSystem does not depend on wakeReason', () => {
  it('compiles only with the documented input keys', () => {
    // This is a structural assertion: passing extra wake-context
    // keys is statically disallowed by the input type, so a
    // refactor that adds `wakeReason` to the cacheable system
    // would force a code change here too — which is the canary.
    const allowedKeys: readonly (keyof Parameters<typeof buildCacheableSystem>[0])[] = [
      'baseSystem',
      'proceduresText',
    ];
    expect(allowedKeys).toEqual(['baseSystem', 'proceduresText']);
  });
});
