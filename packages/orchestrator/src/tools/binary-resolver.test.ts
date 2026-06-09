import { describe, expect, it } from 'vitest';
import { resolveBinaryPath, RG_BINARY } from './binary-resolver.js';

describe('resolveBinaryPath', () => {
  it('resolves vendored rg for the current platform when present', () => {
    let resolved: string;
    try {
      resolved = resolveBinaryPath(RG_BINARY, 'RG_BIN_PATH');
    } catch {
      return;
    }
    expect(resolved).toMatch(/\/rg\/[^/]+\/rg(?:\.exe)?$/);
  });
});
