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

import {
  registerStartup,
  unregisterStartup,
  isStartupRegistered,
  logDir,
  pidFilePath,
} from './auto-startup.js';

describe('macOS (launchd)', () => {
  beforeEach(() => {
    mockPlatform.mockClear();
    mockHomedir.mockClear();
    mockExistsSync.mockClear();
    mockWriteFileSync.mockClear();
    mockUnlinkSync.mockClear();
    mockMkdirSync.mockClear();
    mockExecSync.mockClear();
    delete process.env.UJIMA_HOME;
    process.argv = ['/usr/local/bin/node', '/usr/local/bin/ujima'];
    mockPlatform.mockReturnValue('darwin');
    mockHomedir.mockReturnValue('/Users/testuser');
    mockExistsSync.mockReturnValue(false);
  });

  it('logDir returns ~/.ujima/logs when no UJIMA_HOME', () => {
    expect(logDir()).toBe('/Users/testuser/.ujima/logs');
  });

  it('logDir respects UJIMA_HOME', () => {
    process.env.UJIMA_HOME = '/custom/ujima';
    expect(logDir()).toBe('/custom/ujima/logs');
  });

  it('pidFilePath returns ujima.pid under UJIMA_HOME', () => {
    expect(pidFilePath()).toBe('/Users/testuser/.ujima/ujima.pid');
  });

  it('registerStartup writes plist and loads via launchctl', () => {
    const result = registerStartup();
    expect(result.success).toBe(true);
    expect(mockMkdirSync).toHaveBeenCalledWith(
      '/Users/testuser/Library/LaunchAgents',
      { recursive: true },
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/Users/testuser/Library/LaunchAgents/com.ujima.agents.plist',
      expect.stringContaining('com.ujima.agents'),
      'utf8',
    );
    const plistContent = mockWriteFileSync.mock.calls[0]![1] as string;
    expect(plistContent).toContain('RunAtLoad');
    expect(plistContent).toContain('--background');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('launchctl load'),
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it('registerStartup fails gracefully on error', () => {
    mockWriteFileSync.mockImplementationOnce(() => {
      throw new Error('permission denied');
    });
    const result = registerStartup();
    expect(result.success).toBe(false);
    expect(result.error).toContain('permission denied');
  });

  it('unregisterStartup unloads and deletes plist', () => {
    mockExistsSync.mockReturnValue(true);
    const result = unregisterStartup();
    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('launchctl unload'),
      expect.any(Object),
    );
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      '/Users/testuser/Library/LaunchAgents/com.ujima.agents.plist',
    );
  });

  it('unregisterStartup succeeds even if unload fails', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('could not unload');
    });
    mockExistsSync.mockReturnValue(true);
    const result = unregisterStartup();
    expect(result.success).toBe(true);
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('isStartupRegistered returns true when plist exists and loaded', () => {
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockReturnValue('PID');
    expect(isStartupRegistered()).toBe(true);
  });

  it('isStartupRegistered returns false when plist missing', () => {
    mockExistsSync.mockReturnValue(false);
    expect(isStartupRegistered()).toBe(false);
  });

  it('isStartupRegistered returns false when launchctl errors', () => {
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('not found');
    });
    expect(isStartupRegistered()).toBe(false);
  });
});

describe('Linux (systemd user)', () => {
  beforeEach(() => {
    mockPlatform.mockClear();
    mockHomedir.mockClear();
    mockExistsSync.mockClear();
    mockWriteFileSync.mockClear();
    mockUnlinkSync.mockClear();
    mockMkdirSync.mockClear();
    mockExecSync.mockClear();
    delete process.env.UJIMA_HOME;
    process.argv = ['/usr/local/bin/node', '/usr/local/bin/ujima'];
    mockPlatform.mockReturnValue('linux');
    mockHomedir.mockReturnValue('/home/testuser');
    mockExistsSync.mockReturnValue(false);
  });

  it('registerStartup writes unit and enables via systemctl', () => {
    const result = registerStartup();
    expect(result.success).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/home/testuser/.config/systemd/user/ujima.service',
      expect.stringContaining('[Unit]'),
      'utf8',
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      'systemctl --user daemon-reload',
      expect.objectContaining({ timeout: 15_000 }),
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      'systemctl --user enable ujima.service',
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it('registerStartup fails gracefully on error', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('systemctl not found');
    });
    const result = registerStartup();
    expect(result.success).toBe(false);
    expect(result.error).toContain('systemctl not found');
  });

  it('unregisterStartup disables, deletes, and reloads', () => {
    mockExistsSync.mockReturnValue(true);
    const result = unregisterStartup();
    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'systemctl --user disable ujima.service',
      expect.any(Object),
    );
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('isStartupRegistered returns true when unit exists', () => {
    mockExistsSync.mockReturnValue(true);
    expect(isStartupRegistered()).toBe(true);
  });

  it('isStartupRegistered returns false when unit missing', () => {
    mockExistsSync.mockReturnValue(false);
    expect(isStartupRegistered()).toBe(false);
  });
});

describe('Windows (Registry Run key)', () => {
  beforeEach(() => {
    mockPlatform.mockClear();
    mockHomedir.mockClear();
    mockExistsSync.mockClear();
    mockWriteFileSync.mockClear();
    mockUnlinkSync.mockClear();
    mockMkdirSync.mockClear();
    mockExecSync.mockClear();
    delete process.env.UJIMA_HOME;
    process.argv = ['/usr/local/bin/node', '/usr/local/bin/ujima'];
    mockPlatform.mockReturnValue('win32');
    mockHomedir.mockReturnValue('C:\\Users\\testuser');
    mockExistsSync.mockReturnValue(false);
  });

  it('registerStartup adds Registry Run key', () => {
    const result = registerStartup();
    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('reg add'),
      expect.any(Object),
    );
  });

  it('unregisterStartup deletes the Registry Run key', () => {
    const result = unregisterStartup();
    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('reg delete'),
      expect.any(Object),
    );
  });

  it('isStartupRegistered returns true when reg query succeeds', () => {
    mockExecSync.mockReturnValue('Ujima Agents    REG_SZ    ...');
    expect(isStartupRegistered()).toBe(true);
  });

  it('isStartupRegistered returns false when reg query fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(isStartupRegistered()).toBe(false);
  });
});

describe('unsupported platform', () => {
  beforeEach(() => {
    mockPlatform.mockClear();
    mockHomedir.mockClear();
    mockExistsSync.mockClear();
    mockWriteFileSync.mockClear();
    mockUnlinkSync.mockClear();
    mockMkdirSync.mockClear();
    mockExecSync.mockClear();
    delete process.env.UJIMA_HOME;
    process.argv = ['/usr/local/bin/node', '/usr/local/bin/ujima'];
    mockPlatform.mockReturnValue('freebsd');
    mockHomedir.mockReturnValue('/Users/testuser');
    mockExistsSync.mockReturnValue(false);
  });

  it('registerStartup returns error', () => {
    const result = registerStartup();
    expect(result.success).toBe(false);
    expect(result.error).toContain('freebsd');
  });

  it('unregisterStartup returns error', () => {
    const result = unregisterStartup();
    expect(result.success).toBe(false);
    expect(result.error).toContain('freebsd');
  });

  it('isStartupRegistered returns false', () => {
    expect(isStartupRegistered()).toBe(false);
  });
});
