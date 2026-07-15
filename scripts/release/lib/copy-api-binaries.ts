import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { $ } from 'bun';
import { REPO_ROOT } from './paths.ts';

const VENDOR_PLATFORMS = [
  ['darwin', 'arm64'],
  ['darwin', 'x86_64'],
  ['linux', 'x86_64'],
  ['linux', 'arm64'],
  ['windows', 'x86_64'],
  ['windows', 'arm64'],
] as const;

const ORCHESTRATOR_BIN = join(REPO_ROOT, 'packages/orchestrator/bin');

function storageTriple(os: string, arch: string): string {
  const rustArch =
    arch === 'x86_64' || arch === 'amd64'
      ? 'x86_64'
      : arch === 'arm64' || arch === 'aarch64'
        ? 'aarch64'
        : null;
  if (!rustArch) throw new Error(`Unknown arch: ${arch}`);
  switch (os) {
    case 'darwin':
      return `${rustArch}-apple-darwin`;
    case 'linux':
      return `${rustArch}-unknown-linux-gnu`;
    case 'windows':
    case 'win32':
      return `${rustArch}-pc-windows-msvc`;
    default:
      throw new Error(`Unknown OS: ${os}`);
  }
}

function rgAssetInfo(os: string, arch: string): {
  url: string;
  archiveName: string;
  innerPath: string;
  binaryName: string;
} {
  const version = '15.1.0';
  const triple = storageTriple(os, arch);
  const binaryName = os === 'windows' || os === 'win32' ? 'rg.exe' : 'rg';
  if (os === 'windows' || os === 'win32') {
    return {
      url: `https://github.com/BurntSushi/ripgrep/releases/download/${version}/ripgrep-${version}-${triple}.zip`,
      archiveName: `ripgrep-${version}-${triple}.zip`,
      innerPath: `ripgrep-${version}-${triple}/rg.exe`,
      binaryName,
    };
  }
  const downloadTarget =
    os === 'linux' && (arch === 'x86_64' || arch === 'amd64')
      ? 'x86_64-unknown-linux-musl'
      : triple;
  return {
    url: `https://github.com/BurntSushi/ripgrep/releases/download/${version}/ripgrep-${version}-${downloadTarget}.tar.gz`,
    archiveName: `ripgrep-${version}-${downloadTarget}.tar.gz`,
    innerPath: `ripgrep-${version}-${downloadTarget}/rg`,
    binaryName,
  };
}

function fdAssetInfo(os: string, arch: string): {
  url: string;
  archiveName: string;
  innerPath: string;
  binaryName: string;
} {
  const version = '10.2.0';
  const triple = storageTriple(os, arch);
  const binaryName = os === 'windows' || os === 'win32' ? 'fd.exe' : 'fd';
  if (os === 'windows' || os === 'win32') {
    const downloadTriple =
      arch === 'arm64' || arch === 'aarch64'
        ? 'x86_64-pc-windows-msvc'
        : triple;
    return {
      url: `https://github.com/sharkdp/fd/releases/download/v${version}/fd-v${version}-${downloadTriple}.zip`,
      archiveName: `fd-v${version}-${downloadTriple}.zip`,
      innerPath: `fd-v${version}-${downloadTriple}/fd.exe`,
      binaryName,
    };
  }
  return {
    url: `https://github.com/sharkdp/fd/releases/download/v${version}/fd-v${version}-${triple}.tar.gz`,
    archiveName: `fd-v${version}-${triple}.tar.gz`,
    innerPath: `fd-v${version}-${triple}/fd`,
    binaryName,
  };
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${url} (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await Bun.write(destination, bytes);
}

async function extractArchiveFile(input: {
  archivePath: string;
  innerPath: string;
  destinationPath: string;
}): Promise<void> {
  const extractRoot = join(
    tmpdir(),
    `ujima-vendor-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(extractRoot, { recursive: true });
  try {
    if (input.archivePath.endsWith('.zip')) {
      const expand = await $`powershell -NoProfile -Command Expand-Archive -LiteralPath ${input.archivePath} -DestinationPath ${extractRoot} -Force`
        .quiet()
        .nothrow();
      if (expand.exitCode !== 0) {
        throw new Error(expand.stderr.toString() || `Expand-Archive failed for ${input.archivePath}`);
      }
    } else {
      const untar = await $`tar -xzf ${input.archivePath} -C ${extractRoot}`.quiet().nothrow();
      if (untar.exitCode !== 0) {
        throw new Error(untar.stderr.toString() || `tar extraction failed for ${input.archivePath}`);
      }
    }
    const extracted = join(extractRoot, ...input.innerPath.split('/'));
    if (!existsSync(extracted)) {
      throw new Error(`Archive missing expected path: ${input.innerPath}`);
    }
    mkdirSync(dirname(input.destinationPath), { recursive: true });
    cpSync(extracted, input.destinationPath, { force: true });
  } finally {
    rmSync(extractRoot, { recursive: true, force: true });
  }
}

async function vendorToolOnWindows(input: {
  tool: 'rg' | 'fd';
  os: string;
  arch: string;
}): Promise<void> {
  const info = input.tool === 'rg' ? rgAssetInfo(input.os, input.arch) : fdAssetInfo(input.os, input.arch);
  const triple = storageTriple(input.os, input.arch);
  const targetDir = join(ORCHESTRATOR_BIN, input.tool, triple);
  const targetPath = join(targetDir, info.binaryName);
  if (existsSync(targetPath)) return;

  mkdirSync(targetDir, { recursive: true });
  const archivePath = join(tmpdir(), `${process.pid}-${info.archiveName}`);
  try {
    await downloadFile(info.url, archivePath);
    await extractArchiveFile({
      archivePath,
      innerPath: info.innerPath,
      destinationPath: targetPath,
    });
  } finally {
    rmSync(archivePath, { force: true });
  }
}

async function vendorAllCliBinariesOnWindows(): Promise<void> {
  for (const [os, arch] of VENDOR_PLATFORMS) {
    await vendorToolOnWindows({ tool: 'rg', os, arch });
    await vendorToolOnWindows({ tool: 'fd', os, arch });
  }
}

/** Download rg + fd for all platforms we ship in the npm tarball. */
export async function vendorAllCliBinaries(): Promise<void> {
  try {
    assertExecutableBinaries(ORCHESTRATOR_BIN);
    return;
  } catch {
    // Fall through to the bootstrap download path when the vendored
    // binaries are absent or incomplete.
  }
  if (process.platform === 'win32') {
    await vendorAllCliBinariesOnWindows();
    return;
  }
  const result = await $`bash scripts/vendor-binaries.sh all`.cwd(REPO_ROOT).nothrow();
  if (result.exitCode !== 0) {
    console.error(result.stderr.toString());
    throw new Error('Failed to vendor CLI binaries for release');
  }
}

function assertExecutableBinaries(binRoot: string): void {
  for (const tool of ['rg', 'fd'] as const) {
    const toolRoot = join(binRoot, tool);
    if (!existsSync(toolRoot)) {
      throw new Error(`Missing vendored tool directory: ${toolRoot}`);
    }
    const triples = readdirSync(toolRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    if (triples.length === 0) {
      throw new Error(`No platform builds found under ${toolRoot}`);
    }
    for (const triple of triples) {
      const candidates = [join(toolRoot, triple.name, tool), join(toolRoot, triple.name, `${tool}.exe`)];
      if (!candidates.some((candidate) => existsSync(candidate))) {
        throw new Error(`Missing ${tool} binary under ${join(toolRoot, triple.name)}`);
      }
    }
  }
}

function ensureExecutableBits(binRoot: string): void {
  for (const tool of ['rg', 'fd'] as const) {
    const toolRoot = join(binRoot, tool);
    if (!existsSync(toolRoot)) continue;
    for (const triple of readdirSync(toolRoot, { withFileTypes: true })) {
      if (!triple.isDirectory()) continue;
      for (const name of [tool, `${tool}.exe`]) {
        const fullPath = join(toolRoot, triple.name, name);
        if (!existsSync(fullPath)) continue;
        const mode = statSync(fullPath).mode;
        if ((mode & 0o111) === 0) {
          chmodSync(fullPath, mode | 0o755);
        }
      }
    }
  }
}

/** Copy vendored rg/fd next to the bundled API (`dist/runtime/api/bin`). */
export async function copyApiBinariesToRuntime(apiRuntimeDir: string): Promise<void> {
  await vendorAllCliBinaries();
  assertExecutableBinaries(ORCHESTRATOR_BIN);

  const dest = join(apiRuntimeDir, 'bin');
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  cpSync(ORCHESTRATOR_BIN, dest, { recursive: true });
  ensureExecutableBits(dest);
}
