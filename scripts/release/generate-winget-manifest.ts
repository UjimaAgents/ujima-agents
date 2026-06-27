#!/usr/bin/env bun
/**
 * Generate the Winget installer manifest for a release.
 *
 * Reads the version from packages/distribution/package.json and the SHA256
 * checksums from the platform tarball .sha256 files produced by
 * assemble-platform-tarballs.ts.
 *
 * Usage:
 *   bun scripts/release/generate-winget-manifest.ts
 *
 * Environment:
 *   TARBALLS_DIR  – directory containing ujima-*.tar.gz.sha256 files
 *                   (default: packages/distribution/dist/platform-tarballs)
 *
 * Output: prints the YAML manifest to stdout.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIST_OUT_DIR,
  DISTRIBUTION_PKG_JSON,
} from './lib/paths.ts';

const TARBALLS_DIR = process.env.TARBALLS_DIR ?? join(DIST_OUT_DIR, 'platform-tarballs');

export interface InstallerEntry {
  Architecture: string;
  InstallerType: string;
  InstallerUrl: string;
  InstallerSha256: string;
  NestedInstallerType: string;
  NestedInstallerFiles: { RelativeFilePath: string; PortableCommandAlias: string }[];
  Commands: string[];
}

export interface WingetManifest {
  PackageIdentifier: string;
  PackageVersion: string;
  PackageLocale: string;
  Publisher: string;
  PublisherUrl: string;
  PackageName: string;
  PackageUrl: string;
  License: string;
  LicenseUrl: string;
  ShortDescription: string;
  Description: string;
  Moniker: string;
  Tags: string[];
  Installers: InstallerEntry[];
  ManifestType: string;
  ManifestVersion: string;
}

export function tripleName(os: string, arch: string): string {
  const m: Record<string, Record<string, string>> = {
    windows: { x86_64: 'win-x64', arm64: 'win-arm64' },
  };
  const result = m[os]?.[arch];
  if (!result) throw new Error(`Unknown platform: ${os} ${arch}`);
  return result;
}

export function installerUrl(version: string, triple: string): string {
  const tag = `v${version}`;
  const ext = triple.startsWith('win-') ? 'zip' : 'tar.gz';
  return `https://github.com/UjimaAgents/ujima-agents/releases/download/${tag}/ujima-${version}-${triple}.${ext}`;
}

export function buildManifest(
  version: string,
  x64Sha: string,
  arm64Sha: string,
): WingetManifest {
  return {
    PackageIdentifier: 'UjimaAgents.Ujima',
    PackageVersion: version,
    PackageLocale: 'en-US',
    Publisher: 'Ujima Agents',
    PublisherUrl: 'https://github.com/UjimaAgents',
    PackageName: 'Ujima Agents',
    PackageUrl: 'https://github.com/UjimaAgents/ujima-agents',
    License: 'MIT',
    LicenseUrl:
      'https://github.com/UjimaAgents/ujima-agents/blob/main/LICENSE',
    ShortDescription:
      'Framework for building Slack-like teams of AI agents — CLI, API, and web UI.',
    Description:
      'Ujima is a framework for building teams of AI agents that communicate like Slack channels, with workspace-bounded execution.',
    Moniker: 'ujima',
    Tags: ['ai', 'agents', 'mcp', 'claude', 'developer-tools'],
    Installers: [
      {
        Architecture: 'x64',
        InstallerType: 'zip',
        InstallerUrl: installerUrl(version, tripleName('windows', 'x86_64')),
        InstallerSha256: x64Sha,
        NestedInstallerType: 'portable',
        NestedInstallerFiles: [
          { RelativeFilePath: 'ujima.bat', PortableCommandAlias: 'ujima' },
        ],
        Commands: ['ujima'],
      },
      {
        Architecture: 'arm64',
        InstallerType: 'zip',
        InstallerUrl: installerUrl(version, tripleName('windows', 'arm64')),
        InstallerSha256: arm64Sha,
        NestedInstallerType: 'portable',
        NestedInstallerFiles: [
          { RelativeFilePath: 'ujima.bat', PortableCommandAlias: 'ujima' },
        ],
        Commands: ['ujima'],
      },
    ],
    ManifestType: 'merged',
    ManifestVersion: '1.9.0',
  };
}

export function serializeManifest(m: WingetManifest): string {
  const lines: string[] = [];

  lines.push(`# Winget manifest for Ujima Agents v${m.PackageVersion}`);
  lines.push(`# Submit to https://github.com/microsoft/winget-pkgs`);
  lines.push(`# To submit: fork winget-pkgs, copy this file to`);
  lines.push(`# manifests/u/UjimaAgents/Ujima/${m.PackageVersion}/`);
  lines.push(`# and open a PR.`);
  lines.push('');

  for (const [key, value] of Object.entries(m)) {
    if (key === 'Installers') continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${yamlValue(item)}`);
      }
    } else {
      lines.push(
        `${key}: ${yamlValue(value as string | boolean | number)}`,
      );
    }
  }

  lines.push('Installers:');
  for (const installer of m.Installers) {
    lines.push(`  - Architecture: ${installer.Architecture}`);
    lines.push(`    InstallerType: ${installer.InstallerType}`);
    lines.push(`    InstallerUrl: ${installer.InstallerUrl}`);
    lines.push(`    InstallerSha256: ${installer.InstallerSha256}`);
    lines.push(`    NestedInstallerType: ${installer.NestedInstallerType}`);
    lines.push('    NestedInstallerFiles:');
    for (const file of installer.NestedInstallerFiles) {
      lines.push(
        `      - RelativeFilePath: ${file.RelativeFilePath}`,
      );
      lines.push(
        `        PortableCommandAlias: ${file.PortableCommandAlias}`,
      );
    }
    lines.push('    Commands:');
    for (const cmd of installer.Commands) {
      lines.push(`      - ${cmd}`);
    }
  }

  lines.push(`ManifestType: ${m.ManifestType}`);
  lines.push(`ManifestVersion: ${m.ManifestVersion}`);
  lines.push('');

  return lines.join('\n');
}

function yamlValue(value: string | boolean | number): string {
  if (typeof value === 'string') {
    // Quote if it contains special characters
    if (
      value.includes(': ') ||
      value.includes('#') ||
      value.startsWith('"') ||
      value.includes('\n')
    ) {
      return JSON.stringify(value);
    }
    return value;
  }
  return String(value);
}

export function readSha256(version: string, triple: string, tarballsDir: string): string {
  const ext = triple.startsWith('win-') ? 'zip' : 'tar.gz';
  const shaFile = join(tarballsDir, `ujima-${version}-${triple}.${ext}.sha256`);
  if (!existsSync(shaFile)) {
    throw new Error(
      `SHA256 file not found: ${shaFile}`,
    );
  }
  return readFileSync(shaFile, 'utf8').trim();
}

function readVersion(): string {
  const pkg = JSON.parse(
    readFileSync(DISTRIBUTION_PKG_JSON, 'utf8'),
  ) as { version: string };
  if (!pkg.version) throw new Error('Could not read version from distribution package.json');
  return pkg.version;
}

function main(): void {
  const version = readVersion();
  console.error(`[winget] Generating Winget manifest for v${version}...`);

  const x64Sha = readSha256(
    version,
    tripleName('windows', 'x86_64'),
    TARBALLS_DIR,
  );
  const arm64Sha = readSha256(
    version,
    tripleName('windows', 'arm64'),
    TARBALLS_DIR,
  );

  console.error(`[winget] x64 SHA256: ${x64Sha}`);
  console.error(`[winget] arm64 SHA256: ${arm64Sha}`);

  const manifest = buildManifest(version, x64Sha, arm64Sha);
  process.stdout.write(serializeManifest(manifest));
}

// Only run main() when executed directly, not when imported by tests
if (import.meta.main || process.argv[1]?.endsWith('generate-winget-manifest.ts')) {
  main();
}
