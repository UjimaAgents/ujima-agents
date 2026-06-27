import { describe, expect, it } from 'vitest';
import {
  tripleName,
  installerUrl,
  buildManifest,
  serializeManifest,
} from './generate-winget-manifest.ts';

const FAKE_X64_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FAKE_ARM64_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('tripleName', () => {
  it('returns win-x64 for windows x86_64', () => {
    expect(tripleName('windows', 'x86_64')).toBe('win-x64');
  });

  it('returns win-arm64 for windows arm64', () => {
    expect(tripleName('windows', 'arm64')).toBe('win-arm64');
  });

  it('throws for unknown platforms', () => {
    expect(() => tripleName('linux', 'x86_64')).toThrow('Unknown platform');
    expect(() => tripleName('darwin', 'arm64')).toThrow('Unknown platform');
    expect(() => tripleName('windows', 'i386')).toThrow('Unknown platform');
  });
});

describe('installerUrl', () => {
  it('builds the correct GitHub release URL for win-x64', () => {
    const url = installerUrl('1.2.3', 'win-x64');
    expect(url).toBe(
      'https://github.com/UjimaAgents/ujima-agents/releases/download/v1.2.3/ujima-1.2.3-win-x64.tar.gz',
    );
  });

  it('builds the correct URL for win-arm64', () => {
    const url = installerUrl('0.0.50', 'win-arm64');
    expect(url).toBe(
      'https://github.com/UjimaAgents/ujima-agents/releases/download/v0.0.50/ujima-0.0.50-win-arm64.tar.gz',
    );
  });

  it('strips leading v from version correctly', () => {
    const url = installerUrl('1.0.0', 'win-x64');
    expect(url).toContain('/download/v1.0.0/');
    expect(url).toContain('ujima-1.0.0-win-x64');
  });
});

describe('buildManifest', () => {
  const manifest = buildManifest('1.0.0', FAKE_X64_SHA, FAKE_ARM64_SHA);

  it('sets PackageVersion to the given version', () => {
    expect(manifest.PackageVersion).toBe('1.0.0');
  });

  it('sets PackageIdentifier', () => {
    expect(manifest.PackageIdentifier).toBe('UjimaAgents.Ujima');
  });

  it('creates two installers (x64 + arm64)', () => {
    expect(manifest.Installers).toHaveLength(2);
  });

  it('sets x64 installer SHA256', () => {
    const x64 = manifest.Installers.find((i) => i.Architecture === 'x64');
    expect(x64?.InstallerSha256).toBe(FAKE_X64_SHA);
  });

  it('sets arm64 installer SHA256', () => {
    const arm64 = manifest.Installers.find((i) => i.Architecture === 'arm64');
    expect(arm64?.InstallerSha256).toBe(FAKE_ARM64_SHA);
  });

  it('sets NestedInstallerType to portable', () => {
    for (const installer of manifest.Installers) {
      expect(installer.NestedInstallerType).toBe('portable');
    }
  });

  it('includes ujima.bat as the nested installer file', () => {
    for (const installer of manifest.Installers) {
      expect(installer.NestedInstallerFiles).toHaveLength(1);
      expect(installer.NestedInstallerFiles[0].RelativeFilePath).toBe('ujima.bat');
      expect(installer.NestedInstallerFiles[0].PortableCommandAlias).toBe('ujima');
    }
  });

  it('sets Commands to [ujima]', () => {
    for (const installer of manifest.Installers) {
      expect(installer.Commands).toEqual(['ujima']);
    }
  });

  it('sets ManifestType to merged', () => {
    expect(manifest.ManifestType).toBe('merged');
  });

  it('sets ManifestVersion to 1.9.0', () => {
    expect(manifest.ManifestVersion).toBe('1.9.0');
  });

  it('sets Tags with the expected values', () => {
    expect(manifest.Tags).toContain('ai');
    expect(manifest.Tags).toContain('agents');
    expect(manifest.Tags).toContain('mcp');
  });
});

describe('serializeManifest', () => {
  const manifest = buildManifest('0.0.1', FAKE_X64_SHA, FAKE_ARM64_SHA);
  const yaml = serializeManifest(manifest);

  it('contains the version in a comment', () => {
    expect(yaml).toContain('# Winget manifest for Ujima Agents v0.0.1');
  });

  it('contains the submission instructions', () => {
    expect(yaml).toContain('# Submit to https://github.com/microsoft/winget-pkgs');
  });

  it('contains PackageVersion with the version', () => {
    expect(yaml).toContain('PackageVersion: 0.0.1');
  });

  it('contains both installer SHA256 values', () => {
    expect(yaml).toContain(FAKE_X64_SHA);
    expect(yaml).toContain(FAKE_ARM64_SHA);
  });

  it('contains both architecture entries', () => {
    expect(yaml).toContain('Architecture: x64');
    expect(yaml).toContain('Architecture: arm64');
  });

  it('contains ManifestType and ManifestVersion on their own lines', () => {
    expect(yaml).toContain('ManifestType: merged');
    expect(yaml).toContain('ManifestVersion: 1.9.0');
  });

  it('contains NestedInstallerFiles section', () => {
    expect(yaml).toContain('RelativeFilePath: ujima.bat');
    expect(yaml).toContain('PortableCommandAlias: ujima');
  });
});
