import { describe, expect, it } from 'vitest';
import {
  buildCacheableSystem,
  buildStableWakeContext,
  buildWakeContextMessages,
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

describe('buildStableWakeContext — persisted system message content', () => {
  it('includes the anti-mirror line for fragile models', () => {
    const out = buildStableWakeContext({
      wakeReason: 'mention',
      modelIdString: 'gemini-3.1-pro',
      isMirrorFragile: true,
    });
    expect(out).toContain('anti-mirror');
  });

  it('omits the anti-mirror line for non-fragile models', () => {
    const out = buildStableWakeContext({
      wakeReason: 'mention',
      modelIdString: 'claude-sonnet-4',
      isMirrorFragile: false,
    });
    expect(out).not.toContain('anti-mirror');
  });
});

describe('buildWakeContextMessages — per-wake additions (NOT part of cacheable prefix)', () => {
  it('emits the timestamp only (no anti-mirror, no timezone)', () => {
    const out = buildWakeContextMessages({
      wakeReason: 'mention',
      modelIdString: 'gemini-3.1-pro',
      isMirrorFragile: true,
    });
    expect(out).toHaveLength(1);
    const text = String(out[0]?.content ?? '');
    expect(text).toContain('Current Date & Time');
    expect(text).not.toContain('anti-mirror');
    expect(text).not.toContain('Timezone');
  });
});
