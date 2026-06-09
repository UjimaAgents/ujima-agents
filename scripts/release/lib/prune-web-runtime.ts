import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Directory names safe to remove from production node_modules. */
const REMOVABLE_DIR_NAMES = new Set([
  '__tests__',
  'test',
  'tests',
  'docs',
  '.github',
  'coverage',
  'example',
  'examples',
]);

/** Exact relative paths (under node_modules) to remove when present. */
const REMOVABLE_RELATIVE_PATHS = [
  'next/dist/docs',
  'next/dist/build',
  'next/dist/esm',
  'next/dist/bundle-analyzer',
  'next/dist/next-devtools',
  'next/dist/cli',
  'next/dist/telemetry',
  'next/dist/compiled/@vercel/og/README.md',
];

/** Scoped package directory names under @next that are build-time only. */
const REMOVABLE_NEXT_SCOPE_DIRS = /^swc-/;

function pruneNextScopeBuildTools(
  nodeModulesDir: string,
  stats: { dirs: number; bytes: number },
): void {
  const nextScope = join(nodeModulesDir, '@next');
  if (!existsSync(nextScope)) return;

  for (const entry of readdirSync(nextScope, { withFileTypes: true })) {
    if (!entry.isDirectory() || !REMOVABLE_NEXT_SCOPE_DIRS.test(entry.name)) continue;
    const fullPath = join(nextScope, entry.name);
    stats.bytes += directorySize(fullPath);
    rmSync(fullPath, { recursive: true, force: true });
    stats.dirs += 1;
  }
}

function isRemovableFile(name: string): boolean {
  if (name.endsWith('.map') || name.endsWith('.map.gz')) return true;
  if (name.endsWith('.d.ts') || name.endsWith('.d.cts') || name.endsWith('.d.mts')) {
    return true;
  }
  if (name.endsWith('.md') || name === 'CHANGELOG' || name.startsWith('CHANGELOG.')) {
    return true;
  }
  if (/\.(test|spec)\.(js|mjs|cjs|ts|tsx|jsx)$/.test(name)) return true;
  return false;
}

function pruneTree(dir: string, stats: { files: number; dirs: number; bytes: number }): void {
  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (REMOVABLE_DIR_NAMES.has(entry.name)) {
        const size = directorySize(fullPath);
        rmSync(fullPath, { recursive: true, force: true });
        stats.dirs += 1;
        stats.bytes += size;
        continue;
      }
      pruneTree(fullPath, stats);
      continue;
    }

    if (isRemovableFile(entry.name)) {
      const size = statSync(fullPath).size;
      rmSync(fullPath);
      stats.files += 1;
      stats.bytes += size;
    }
  }
}

function directorySize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(fullPath);
    } else {
      total += statSync(fullPath).size;
    }
  }
  return total;
}

function pruneZodLocales(nodeModulesDir: string, stats: { files: number; bytes: number }): void {
  const localesDir = join(nodeModulesDir, 'zod', 'v4', 'locales');
  if (!existsSync(localesDir)) return;

  const keep = new Set(['en.cjs', 'en.js', 'en.d.ts', 'en.d.cts', 'index.cjs', 'index.js', 'index.d.ts', 'index.d.cts']);

  for (const entry of readdirSync(localesDir, { withFileTypes: true })) {
    if (!entry.isFile() || keep.has(entry.name)) continue;
    const fullPath = join(localesDir, entry.name);
    stats.bytes += statSync(fullPath).size;
    rmSync(fullPath);
    stats.files += 1;
  }
}

function pruneKnownPaths(nodeModulesDir: string, stats: { dirs: number; bytes: number }): void {
  for (const rel of REMOVABLE_RELATIVE_PATHS) {
    const fullPath = join(nodeModulesDir, rel);
    if (!existsSync(fullPath)) continue;
    const size = directorySize(fullPath);
    rmSync(fullPath, { recursive: true, force: true });
    stats.dirs += 1;
    stats.bytes += size;
  }
}

export type PruneWebRuntimeStats = {
  files: number;
  dirs: number;
  bytes: number;
};

/** Remove docs, types, tests, and other dead weight from web runtime node_modules. */
export function pruneWebRuntimeNodeModules(nodeModulesDir: string): PruneWebRuntimeStats {
  const stats: PruneWebRuntimeStats = { files: 0, dirs: 0, bytes: 0 };
  if (!existsSync(nodeModulesDir)) return stats;

  pruneKnownPaths(nodeModulesDir, stats);
  pruneNextScopeBuildTools(nodeModulesDir, stats);
  pruneZodLocales(nodeModulesDir, stats);
  pruneTree(nodeModulesDir, stats);

  return stats;
}

export function formatPruneStats(stats: PruneWebRuntimeStats): string {
  const mb = (stats.bytes / (1024 * 1024)).toFixed(1);
  return `${stats.files} file(s), ${stats.dirs} dir(s), ~${mb} MB`;
}
