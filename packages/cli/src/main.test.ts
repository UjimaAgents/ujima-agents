import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareVersions } from './version.js';
import {
  buildApiDisplayUrl,
  buildWebUrl,
  shouldSkipOpenBrowser,
} from './open-browser.js';
import { stripAnsi } from './cli-branding.js';

describe('CLI main utilities', () => {
  describe('compareVersions', () => {
    it('returns positive when v1 > v2', () => {
      expect(compareVersions('0.0.8', '0.0.7')).toBeGreaterThan(0);
      expect(compareVersions('v0.1.0', '0.0.9')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
      expect(compareVersions('2.0.0', '1.10.5')).toBeGreaterThan(0);
    });

    it('returns negative when v1 < v2', () => {
      expect(compareVersions('0.0.7', '0.0.8')).toBeLessThan(0);
      expect(compareVersions('0.0.9', 'v0.1.0')).toBeLessThan(0);
      expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
      expect(compareVersions('1.10.5', '2.0.0')).toBeLessThan(0);
    });

    it('returns 0 when v1 == v2', () => {
      expect(compareVersions('0.0.7', '0.0.7')).toBe(0);
      expect(compareVersions('v0.1.0', '0.1.0')).toBe(0);
      expect(compareVersions('1.0.0-alpha.1', '1.0.0')).toBe(0);
    });
  });

  describe('open-browser helpers', () => {
    const envBackup = { ...process.env };

    beforeEach(() => {
      process.env = { ...envBackup };
    });

    afterEach(() => {
      process.env = envBackup;
      vi.restoreAllMocks();
    });

    it('buildWebUrl uses WEB_PORT with localhost', () => {
      process.env.WEB_PORT = '4000';
      expect(buildWebUrl()).toBe('http://localhost:4000');
    });

    it('buildApiDisplayUrl maps loopback bind host to localhost', () => {
      process.env.UJIMA_BIND_HOST = '127.0.0.1';
      process.env.UJIMA_PORT = '7511';
      expect(buildApiDisplayUrl()).toBe('http://localhost:7511');
    });

    it('shouldSkipOpenBrowser when --no-open is passed', () => {
      const isTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      expect(shouldSkipOpenBrowser(['--no-open'])).toBe(true);
      expect(shouldSkipOpenBrowser([])).toBe(false);
      if (isTTY) {
        Object.defineProperty(process.stdout, 'isTTY', isTTY);
      }
    });

    it('shouldSkipOpenBrowser when UJIMA_NO_OPEN is set', () => {
      process.env.UJIMA_NO_OPEN = '1';
      expect(shouldSkipOpenBrowser([])).toBe(true);
      process.env.UJIMA_NO_OPEN = 'true';
      expect(shouldSkipOpenBrowser([])).toBe(true);
    });

    it('shouldSkipOpenBrowser when stdout is not a TTY', () => {
      const isTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      expect(shouldSkipOpenBrowser([])).toBe(true);
      if (isTTY) {
        Object.defineProperty(process.stdout, 'isTTY', isTTY);
      }
    });
  });

  describe('stripAnsi', () => {
    it('removes ANSI color codes', () => {
      expect(stripAnsi('\u001b[32mok\u001b[0m')).toBe('ok');
    });
  });
});
