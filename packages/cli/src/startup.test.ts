import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// chalk returns plain text in tests
vi.mock('chalk', () => {
  const identity = (s: string) => s;
  identity.italic = identity;
  identity.dim = identity;
  identity.bold = identity;
  identity.underline = identity;
  identity.reset = identity;
  identity.strip = identity;
  const chalkFn = Object.assign(identity, {
    green: identity,
    red: identity,
    yellow: identity,
    blue: identity,
    cyan: identity,
    white: identity,
    gray: identity,
    grey: identity,
    bold: identity,
    dim: identity,
    italic: identity,
    underline: identity,
    reset: identity,
    strip: identity,
  });
  return { default: chalkFn, ...chalkFn };
});

// Mock process.exit to throw instead of actually exiting
const originalExit = process.exit;
beforeEach(() => {
  process.exit = ((code?: number) => {
    throw new Error(`process.exit called with ${code}`);
  }) as typeof process.exit;
});

afterEach(() => {
  process.exit = originalExit;
});

import { cmdStartup } from './main.js';

describe('cmdStartup', () => {
  beforeEach(() => {
    mockPlatform.mockReset();
    mockHomedir.mockReset();
    mockExistsSync.mockReset();
    mockWriteFileSync.mockReset();
    mockUnlinkSync.mockReset();
    mockMkdirSync.mockReset();
    mockExecSync.mockReset();
    process.env.UJIMA_HOME = '/test/.ujima';
    process.argv = ['/usr/bin/node', '/usr/local/bin/ujima'];
    mockPlatform.mockReturnValue('darwin');
    mockHomedir.mockReturnValue('/Users/testuser');
    mockExistsSync.mockReturnValue(false);
    process.argv = ['/usr/bin/node', '/usr/local/bin/ujima'];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  describe('register subcommand', () => {
    it('succeeds and prints a success message', async () => {
      const stdoutWrite = vi.spyOn(process.stdout, 'write');
      await cmdStartup(['register']);
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('launchctl load'),
        expect.any(Object),
      );
      expect(stdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining('Registered Ujima to start automatically on boot'),
      );
    });

    it('prints error message and exits on failure', async () => {
      const stderrWrite = vi.spyOn(process.stderr, 'write');
      mockWriteFileSync.mockImplementationOnce(() => {
        throw new Error('permission denied');
      });
      await expect(cmdStartup(['register'])).rejects.toThrow('process.exit called with 1');
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Failed to register Ujima for automatic startup'),
      );
    });
  });

  describe('unregister subcommand', () => {
    it('succeeds and prints a success message', async () => {
      const stdoutWrite = vi.spyOn(process.stdout, 'write');
      mockExistsSync.mockReturnValue(true);
      await cmdStartup(['unregister']);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('launchctl unload'),
        expect.any(Object),
      );
      expect(mockUnlinkSync).toHaveBeenCalled();
      expect(stdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining('Removed Ujima from system startup'),
      );
    });

    it('prints error message and exits on failure', async () => {
      const stderrWrite = vi.spyOn(process.stderr, 'write');
      mockUnlinkSync.mockImplementationOnce(() => {
        throw new Error('permission denied');
      });
      mockExistsSync.mockReturnValue(true);
      await expect(cmdStartup(['unregister'])).rejects.toThrow('process.exit called with 1');
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove Ujima from system startup'),
      );
    });
  });

  describe('status subcommand', () => {
    it('reports registered when startup is configured', async () => {
      const stdoutWrite = vi.spyOn(process.stdout, 'write');
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue('PID');
      await cmdStartup(['status']);
      expect(stdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining('Ujima is registered to start automatically on boot'),
      );
    });

    it('reports not registered when startup is not configured', async () => {
      const stdoutWrite = vi.spyOn(process.stdout, 'write');
      await cmdStartup(['status']);
      expect(stdoutWrite).toHaveBeenCalledWith(
        expect.stringContaining('Ujima is not registered for automatic startup'),
      );
    });
  });

  describe('unknown subcommand', () => {
    it('prints error and exits with code 2', async () => {
      const stderrWrite = vi.spyOn(process.stderr, 'write');
      await expect(cmdStartup(['unknown'])).rejects.toThrow('process.exit called with 2');
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('unknown subcommand'),
      );
    });
  });

  describe('no subcommand', () => {
    it('prints error and exits with code 2', async () => {
      const stderrWrite = vi.spyOn(process.stderr, 'write');
      await expect(cmdStartup([])).rejects.toThrow('process.exit called with 2');
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('unknown subcommand'),
      );
    });
  });
});
