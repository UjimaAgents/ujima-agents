import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** npm publish staging dir — shares the product name but is not the dev workspace root. */
function isDistributionPackageDir(dir: string): boolean {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
    return (
      pkg.name === '@ujima/agents' ||
      pkg.name === '@ujima/distribution' ||
      pkg.name === 'ujima-agents-publish'
    );
  } catch {
    return false;
  }
}

function isMonorepoRoot(dir: string): boolean {
  if (isDistributionPackageDir(dir)) return false;
  if (!existsSync(join(dir, 'turbo.json'))) return false;
  if (!existsSync(join(dir, 'bun.lock'))) return false;
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      name?: string;
      private?: boolean;
      workspaces?: unknown;
    };
    return (
      pkg.name === 'ujima-agents' &&
      pkg.private === true &&
      Array.isArray(pkg.workspaces)
    );
  } catch {
    return false;
  }
}

/** Walk ancestors for the private Bun/Turbo workspace root (not packages/distribution). */
export function findMonorepoRoot(startDir = process.cwd()): string | null {
  let dir = startDir;
  while (true) {
    if (isMonorepoRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Directory containing `runtime/api` and `runtime/web` when installed from npm. */
export function resolvePackagedRuntimeDir(cliDirname: string): string | null {
  const runtimeDir = join(cliDirname, 'runtime');
  const apiMain = join(runtimeDir, 'api', 'main.js');
  if (existsSync(apiMain)) return runtimeDir;
  return null;
}

/** Next standalone server entry (monorepo or flat layout). */
export function resolveWebServerEntry(webRuntimeDir: string): string | null {
  const candidates = [
    join(webRuntimeDir, 'apps/web/server.js'),
    join(webRuntimeDir, 'server.js'),
  ];
  for (const entry of candidates) {
    if (existsSync(entry)) return entry;
  }
  return null;
}

export function resolveWebServerCwd(webRuntimeDir: string, serverEntry: string): string {
  const appWebCwd = join(webRuntimeDir, 'apps/web');
  if (serverEntry.startsWith(appWebCwd)) return appWebCwd;
  return dirname(serverEntry);
}
