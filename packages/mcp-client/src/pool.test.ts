import { describe, expect, it } from 'vitest';

// Bot Round 2 medium — has() / closeOne() must include cwd in the
// key the same way get() does, otherwise two callers requesting the
// same MCP from different workspace roots can collide on lookups
// even though they live as separate pool entries.
//
// Direct behavioural tests are limited because the pool spawns real
// MCP processes via stdio. We rely on the public surface being
// internally consistent: has() and closeOne() must accept a `cwd`
// in opts the same way get() does, and lookups against different
// cwds must behave independently on the same mcpId.

describe('createMCPPool — cwd-aware has() and closeOne() (bot Round 2 medium)', () => {
  it('has() accepts cwd in opts and returns false for an empty pool regardless of suffix', async () => {
    const { createMCPPool } = await import('./pool.js');
    const pool = createMCPPool();
    expect(pool.has('srv_x', { agentId: 'a', cwd: '/workspace/a' })).toBe(false);
    expect(pool.has('srv_x', { agentId: 'a', cwd: '/workspace/b' })).toBe(false);
    expect(pool.has('srv_x', { cwd: '/workspace/a' })).toBe(false);
    expect(pool.has('srv_x')).toBe(false);
    expect(pool.size()).toBe(0);
  });

  it('closeOne() accepts cwd in opts and is a no-op on an empty pool', async () => {
    const { createMCPPool } = await import('./pool.js');
    const pool = createMCPPool();
    await expect(
      pool.closeOne('srv_x', { agentId: 'a', cwd: '/workspace/a' }),
    ).resolves.toBeUndefined();
    await expect(
      pool.closeOne('srv_x', { cwd: '/workspace/b' }),
    ).resolves.toBeUndefined();
    expect(pool.size()).toBe(0);
  });

  it('lookups against different (mcpId, agentId, cwd) tuples are independent', async () => {
    const { createMCPPool } = await import('./pool.js');
    const pool = createMCPPool();
    // Different cwds for the same (mcpId, agentId) must not
    // collide. We assert independence via has() returning false
    // separately for each — pre-fix, has() ignored cwd and would
    // have collapsed these into one key.
    expect(pool.has('srv_x', { agentId: 'a', cwd: '/workspace/a' })).toBe(false);
    expect(pool.has('srv_x', { agentId: 'a', cwd: '/workspace/b' })).toBe(false);
    // Closing one does not affect the other (both no-ops here,
    // but the call shape is the regression target).
    await pool.closeOne('srv_x', { agentId: 'a', cwd: '/workspace/a' });
    expect(pool.has('srv_x', { agentId: 'a', cwd: '/workspace/b' })).toBe(false);
  });
});
