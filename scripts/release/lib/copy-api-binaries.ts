import { chmodSync, cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

/** Download rg + fd for all platforms we ship in the npm tarball. */
export async function vendorAllCliBinaries(): Promise<void> {
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
