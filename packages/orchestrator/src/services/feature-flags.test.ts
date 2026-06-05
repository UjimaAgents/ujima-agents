import { describe, expect, it } from 'vitest';
import { isMcpDispatchEnabled } from './feature-flags.js';

// One load-bearing invariant: the flag is the kill switch (§3.5 rule 8).
// Wrong default = silent shipping of an unproven path. Wrong truthy
// parsing = operators setting UJIMA_MCP_DISPATCH=true and getting
// silent off.

describe('isMcpDispatchEnabled — kill-switch invariants', () => {
  it('defaults off and accepts the canonical truthy strings, rejects the rest', () => {
    expect(isMcpDispatchEnabled({})).toBe(false);
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE', ' On ']) {
      expect(isMcpDispatchEnabled({ UJIMA_MCP_DISPATCH: v })).toBe(true);
    }
    for (const v of ['0', 'false', 'no', 'off', '', 'maybe']) {
      expect(isMcpDispatchEnabled({ UJIMA_MCP_DISPATCH: v })).toBe(false);
    }
  });
});
