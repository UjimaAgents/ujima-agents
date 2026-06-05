import { describe, expect, it } from 'vitest';
import { isMcpDispatchEnabled } from './feature-flags.js';

describe('isMcpDispatchEnabled', () => {
  it('defaults to off when UJIMA_MCP_DISPATCH is unset', () => {
    expect(isMcpDispatchEnabled({})).toBe(false);
  });

  it("treats the canonical truthy values as on (matches operator habit)", () => {
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE', ' On ']) {
      expect(isMcpDispatchEnabled({ UJIMA_MCP_DISPATCH: v })).toBe(true);
    }
  });

  it('treats anything else as off (safe default)', () => {
    for (const v of ['0', 'false', 'no', 'off', '', 'maybe', '2']) {
      expect(isMcpDispatchEnabled({ UJIMA_MCP_DISPATCH: v })).toBe(false);
    }
  });

  it('reads process.env by default', () => {
    const original = process.env.UJIMA_MCP_DISPATCH;
    try {
      delete process.env.UJIMA_MCP_DISPATCH;
      expect(isMcpDispatchEnabled()).toBe(false);
      process.env.UJIMA_MCP_DISPATCH = '1';
      expect(isMcpDispatchEnabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.UJIMA_MCP_DISPATCH;
      else process.env.UJIMA_MCP_DISPATCH = original;
    }
  });
});
