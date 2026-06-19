import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPlatform = vi.fn(() => 'darwin');
const mockHomedir = vi.fn(() => '/Users/testuser');
const mockExistsSync = vi.fn((..._args: unknown[]) => false);
const mockWriteFileSync = vi.fn((..._args: unknown[]) => undefined);
const mockUnlinkSync = vi.fn((..._args: unknown[]) => undefined);
const mockMkdirSync = vi.fn((..._args: unknown[]) => undefined);
const mockExecSync = vi.fn((..._args: unknown[]): unknown => undefined);

vi.mock('node:os', () => ({
  platform: () => mockPlatform(),
  homedir: () => mockHomedir(),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import { registerStartup } from './auto-startup.js';

describe('CLI argument resolution', () => {
  beforeEach(() => {
    mockPlatform.mockClear();
    mockHomedir.mockClear();
    mockExistsSync.mockClear();
    mockWriteFileSync.mockClear();
    mockUnlinkSync.mockClear();
    mockMkdirSync.mockClear();
    mockExecSync.mockClear();
    delete process.env.UJIMA_HOME;
    process.argv = ['/usr/bin/node', '/path/to/node_modules/.bin/ujima'];
    mockPlatform.mockReturnValue('darwin');
    mockHomedir.mockReturnValue('/Users/testuser');
    mockExistsSync.mockReturnValue(false);
  });

  it('uses process.argv[1] as script path in plist', () => {
    const result = registerStartup();
    expect(result.success).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const plistContent = mockWriteFileSync.mock.calls[0]![1] as string;
    expect(plistContent).toContain('/path/to/node_modules/.bin/ujima');
    expect(plistContent).toContain('start');
    expect(plistContent).toContain('--background');
  });

  it('handles spaces in executable paths', () => {
    process.argv = ['/usr/bin/node', '/path/to/ujima agents/cli.js'];
    const result = registerStartup();
    expect(result.success).toBe(true);
    const plistContent = mockWriteFileSync.mock.calls[0]![1] as string;
    expect(plistContent).toContain('ujima agents/cli.js');
  });
});
