import { describe, expect, it } from 'vitest';
import { isMcpDispatchEnabled } from './feature-flags.js';

// One load-bearing invariant: the flag is the kill switch (§3.5 rule 8).
// As of the §13.2 "default on" flip, V2 is the default — so the kill
// switch is now opt-OUT. Wrong default = silently dropping every org
// back to legacy. Wrong falsy parsing = operators setting
// UJIMA_MCP_DISPATCH=false and getting silent on.

describe('isMcpDispatchEnabled — kill-switch invariants', () => {
  it('defaults on; canonical false strings disable, everything else stays on', () => {
    // Unset → V2 on (the new default).
    expect(isMcpDispatchEnabled(undefined, {})).toBe(true);
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE', ' On ']) {
      expect(isMcpDispatchEnabled(undefined, { UJIMA_MCP_DISPATCH: v })).toBe(true);
    }
    // Canonical false strings engage the kill switch.
    for (const v of ['0', 'false', 'no', 'off', 'OFF', ' False ']) {
      expect(isMcpDispatchEnabled(undefined, { UJIMA_MCP_DISPATCH: v })).toBe(false);
    }
    // Empty / non-canonical values are NOT a kill switch → default on.
    for (const v of ['', 'maybe']) {
      expect(isMcpDispatchEnabled(undefined, { UJIMA_MCP_DISPATCH: v })).toBe(true);
    }
  });

  it('keeps allowlisted orgs on V2 even when the kill switch is engaged', () => {
    const env = {
      UJIMA_MCP_DISPATCH: 'false',
      UJIMA_MCP_DISPATCH_ORG_ALLOWLIST: 'org_dogfood,org_pilot',
    };
    expect(isMcpDispatchEnabled('org_dogfood', env)).toBe(true);
    expect(isMcpDispatchEnabled('org_pilot', env)).toBe(true);
    expect(isMcpDispatchEnabled('org_other', env)).toBe(false);
    // No org context, kill switch engaged → off.
    expect(isMcpDispatchEnabled(undefined, env)).toBe(false);
  });

});
