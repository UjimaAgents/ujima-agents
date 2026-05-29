import { describe, expect, it } from 'vitest';
import { compareVersions } from './main.js';

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
      expect(compareVersions('1.0.0-alpha.1', '1.0.0')).toBe(0); // Ignores prerelease tags
    });
  });
});
