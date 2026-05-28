import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** Bun stores packages as `.bun/name@version+hash/node_modules/<pkg>` without top-level symlinks. */
export function bunFolderToPackageName(folder: string): string {
  const versionAt = folder.lastIndexOf('@');
  if (versionAt <= 0) return folder;
  const namePart = folder.slice(0, versionAt);
  if (namePart.startsWith('@')) {
    const slashAt = namePart.indexOf('+');
    if (slashAt !== -1) {
      return `${namePart.slice(0, slashAt)}/${namePart.slice(slashAt + 1)}`;
    }
  }
  const plusAt = namePart.indexOf('+');
  if (plusAt !== -1) return namePart.slice(0, plusAt);
  return namePart;
}

function ensureDirSymlink(linkPath: string, target: string): void {
  if (existsSync(linkPath)) return;
  mkdirSync(dirname(linkPath), { recursive: true });
  const relTarget = relative(dirname(linkPath), target);
  symlinkSync(relTarget, linkPath, 'dir');
}

/**
 * Node cannot resolve `require('next')` from Bun's `.bun/` store alone.
 * Create standard `node_modules/<pkg>` symlinks for each traced standalone dependency.
 */
export function repairBunStyleNodeModules(nodeModulesDir: string): number {
  const bunDir = join(nodeModulesDir, '.bun');
  if (!existsSync(bunDir)) return 0;

  let linked = 0;
  for (const entry of readdirSync(bunDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pkgName = bunFolderToPackageName(entry.name);
    const storeRoot = join(bunDir, entry.name, 'node_modules');
    const target = join(storeRoot, pkgName);
    if (!existsSync(target)) continue;

    const linkPath = join(nodeModulesDir, ...pkgName.split('/'));
    if (existsSync(linkPath)) continue;

    ensureDirSymlink(linkPath, target);
    linked += 1;
  }

  return linked;
}
