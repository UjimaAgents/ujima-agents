import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Platform detection ────────────────────────────────────────────
type Platform = 'darwin' | 'linux' | 'win32';
type Arch = 'x64' | 'arm64';

export interface BinaryDescriptor {
  /** Human-readable name for error messages */
  name: string;
  /** Vendored directory name, e.g. `rg`, `fd`, `eza` */
  dir: string;
  /** Filename on disk (platform-dependent extension handled automatically) */
  filename: string;
  /** Optional system path fallback (e.g. '/usr/bin/curl'). Used when vendored binary not found. */
  systemPath?: string;
}

const CURRENT_PLATFORM = process.platform as Platform;
const CURRENT_ARCH = process.arch as Arch;

function platformTriple(platform: Platform, arch: Arch): string {
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (platform === 'win32' && arch === 'arm64') return 'aarch64-pc-windows-msvc';
  throw new Error(`Unsupported platform/arch: ${platform}/${arch}`);
}

/**
 * Resolve the absolute path to a vendored binary.
 *
 * Resolution order:
 * 1. Environment variable override (e.g. `RG_BIN_PATH`)
 * 2. Vendored binary under `packages/orchestrator/bin/` relative to cwd
 * 3. Vendored binary under `bin/` relative to cwd
 *
 * When running from the monorepo root (typical for dev), cwd is the
 * monorepo root and the vendored path is:
 *   packages/orchestrator/bin/rg/aarch64-apple-darwin/rg
 */
export function resolveBinaryPath(
  descriptor: BinaryDescriptor,
  envVar?: string,
): string {
  // 1. Environment variable override
  if (envVar) {
    const override = process.env[envVar];
    if (override) {
      if (!existsSync(override)) {
        throw new Error(
          `${envVar}=${override} points to a non-existent file. ` +
            `Fix or unset the environment variable.`,
        );
      }
      return override;
    }
  }

  // 2. Search known locations
  const triple = platformTriple(CURRENT_PLATFORM, CURRENT_ARCH);
  const binName =
    CURRENT_PLATFORM === 'win32' ? `${descriptor.filename}.exe` : descriptor.filename;

  const candidates = [
    join(process.cwd(), 'packages/orchestrator/bin', descriptor.dir, triple, binName),
    join(process.cwd(), 'bin', descriptor.dir, triple, binName),
    join(process.cwd(), 'node_modules/.bin', binName),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // 3. System path fallback (for curl, sed, etc.)
  if (descriptor.systemPath && existsSync(descriptor.systemPath)) {
    return descriptor.systemPath;
  }

  throw new Error(
    `Vendored binary '${descriptor.name}' not found for ${CURRENT_PLATFORM}/${CURRENT_ARCH}. ` +
      `Searched: ${candidates.join(', ')}. ` +
      `Run 'scripts/vendor-binaries.sh' to download binaries, ` +
      `or set the ${envVar ?? descriptor.name.toUpperCase() + '_BIN_PATH'} env var.`,
  );
}

// ── Well-known binary descriptors ─────────────────────────────────

export const RG_BINARY: BinaryDescriptor = {
  name: 'ripgrep',
  dir: 'rg',
  filename: 'rg',
};

export const FD_BINARY: BinaryDescriptor = {
  name: 'fd',
  dir: 'fd',
  filename: 'fd',
};

export const CURL_BINARY: BinaryDescriptor = {
  name: 'curl',
  dir: 'curl',
  filename: 'curl',
  // macOS ships curl at /usr/bin/curl; Linux containers typically have it on PATH
  systemPath: process.platform === 'darwin' ? '/usr/bin/curl' : undefined,
};

/** sed is used for file window extraction by the view tool */
export const SED_BINARY: BinaryDescriptor = {
  name: 'sed',
  dir: 'sed',
  filename: 'sed',
  systemPath: '/usr/bin/sed',
};

export const EZA_BINARY: BinaryDescriptor = {
  name: 'eza',
  dir: 'eza',
  filename: 'eza',
};
