import { describe, expect, it } from 'vitest';
import { CURATED_REGISTRY, instantiateFromRegistry } from './registry';

describe('curated registry', () => {
  it('includes the Day-1 minimum: filesystem + sqlite', () => {
    const ids = CURATED_REGISTRY.map((e) => e.id);
    expect(ids).toContain('filesystem');
    expect(ids).toContain('sqlite');
  });

  it('throws on unknown ids', () => {
    expect(() => instantiateFromRegistry('nope')).toThrow(/Unknown registry entry/);
  });

  it('ships git, github, postgres, notion, slack (v0.2 expansion)', () => {
    const ids = CURATED_REGISTRY.map((e) => e.id);
    for (const expected of ['git', 'github', 'postgres', 'notion', 'slack']) {
      expect(ids).toContain(expected);
    }
  });

  // PR 2 — connector dispatch substrate expansion. Two load-bearing
  // invariants only; per-entry shape assertions are not worth the
  // upkeep (typecheck already enforces the RegistryEntry contract).

});
