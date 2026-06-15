import { describe, expect, it } from 'vitest';
import type { MCPDef } from '@ujima/shared';
import {
  connectMCPWithCacheRecovery,
  looksLikeNpmCacheCorruption,
} from './cache-recovery';
import type { MCPConnection } from './connection';

// Stand-in for an opened MCP. We never call into it from these tests.
const fakeConnection: MCPConnection = {
  id: 'fake',
  def: {} as MCPDef,
  listTools: async () => [],
  callTool: async () => ({ content: null }),
  close: async () => undefined,
  isOpen: () => true,
};

// The exact stderr surfaced in the bug report — keep verbatim so the
// signature detector stays anchored to the real failure.
const REAL_NPM_CACHE_ERROR =
  "MCP error -32000: Connection closed — child stderr: npm error code EEXIST npm error syscall rename npm error path /Users/mac/.npm/_cacache/tmp/*** npm error dest /Users/mac/.npm/_cacache/content-v2/sha512/8d/...";

const baseDef: MCPDef = {
  id: 'computer-use',
  name: 'computer-use',
  version: '0.0.0',
  description: '',
  category: 'general',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'some-package'],
  env: {},
  isolation: 'shared',
};

describe('looksLikeNpmCacheCorruption', () => {
  it('matches the real npm EEXIST/_cacache error from the bug report', () => {
    expect(looksLikeNpmCacheCorruption(REAL_NPM_CACHE_ERROR)).toBe(true);
  });

});

describe('connectMCPWithCacheRecovery', () => {
  it('retries with NPM_CONFIG_CACHE when stderr matches the npm-cache signature', async () => {
    const calls: { env?: Record<string, string> }[] = [];
    let attempt = 0;
    const connector = async (def: MCPDef) => {
      calls.push({ env: def.env });
      attempt += 1;
      if (attempt === 1) throw new Error(REAL_NPM_CACHE_ERROR);
      return fakeConnection;
    };
    const res = await connectMCPWithCacheRecovery(baseDef, {}, connector);
    expect(attempt).toBe(2);
    expect(calls[0]?.env).toEqual({});
    expect(calls[1]?.env?.NPM_CONFIG_CACHE).toMatch(/^\/tmp\/ujima-mcp-cache-/);
    expect(res.recovery).toEqual({
      isolatedCache: true,
      reason: 'npm-cache-corrupted',
      cacheDir: calls[1]!.env!.NPM_CONFIG_CACHE,
    });
  });

});
