import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
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

/** True when a traced package has a loadable entry (Next standalone often traces only package.json). */
export function packageEntryExists(pkgDir: string): boolean {
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      main?: string;
      module?: string;
      exports?: unknown;
    };
    const candidates = [pkg.main, pkg.module, 'index.js'].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    if (candidates.some((rel) => existsSync(join(pkgDir, rel)))) return true;
    if (pkg.exports && typeof pkg.exports === 'object') {
      const root = (pkg.exports as Record<string, unknown>)['.'];
      if (typeof root === 'string' && existsSync(join(pkgDir, root))) return true;
      if (root && typeof root === 'object') {
        const record = root as Record<string, unknown>;
        for (const key of ['default', 'import', 'require']) {
          const value = record[key];
          if (typeof value === 'string' && existsSync(join(pkgDir, value))) return true;
        }
      }
    }
  } catch {
    // fall through
  }
  return existsSync(join(pkgDir, 'index.js'));
}

function* walkPackageDirs(modulesDir: string): Generator<string> {
  if (!existsSync(modulesDir)) return;
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    if (entry.name.startsWith('@')) {
      const scopeDir = join(modulesDir, entry.name);
      for (const scoped of readdirSync(scopeDir, { withFileTypes: true })) {
        if (scoped.isDirectory()) yield join(scopeDir, scoped.name);
      }
      continue;
    }
    yield join(modulesDir, entry.name);
  }
}

function resolveMonorepoPackageSource(
  monorepoRoot: string,
  bunFolderName: string,
  storeModulesDir: string,
  destPkg: string,
): string | null {
  const monorepoBun = join(monorepoRoot, 'node_modules', '.bun');
  const relFromStore = relative(storeModulesDir, destPkg);
  const storeCandidate = join(monorepoBun, bunFolderName, 'node_modules', relFromStore);
  if (existsSync(storeCandidate) && packageEntryExists(storeCandidate)) {
    return storeCandidate;
  }

  const topLevel = join(monorepoRoot, 'node_modules', relFromStore);
  if (existsSync(topLevel) && packageEntryExists(topLevel)) {
    return topLevel;
  }

  if (!existsSync(monorepoBun)) return null;
  for (const entry of readdirSync(monorepoBun, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(monorepoBun, entry.name, 'node_modules', relFromStore);
    if (existsSync(candidate) && packageEntryExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function copyPackageTree(source: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(source, dest, { recursive: true, dereference: true });
}

/**
 * Next standalone tracing can leave package.json-only stubs in Bun's `.bun/`
 * store (e.g. react@18.3.1). Copy full trees from the monorepo workspace.
 */
export function hydrateTracedBunStorePackages(
  nodeModulesDir: string,
  monorepoRoot: string,
): number {
  const bunDir = join(nodeModulesDir, '.bun');
  if (!existsSync(bunDir)) return 0;

  let hydrated = 0;
  for (const entry of readdirSync(bunDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const storeModules = join(bunDir, entry.name, 'node_modules');
    for (const destPkg of walkPackageDirs(storeModules)) {
      if (packageEntryExists(destPkg)) continue;
      const sourcePkg = resolveMonorepoPackageSource(
        monorepoRoot,
        entry.name,
        storeModules,
        destPkg,
      );
      if (!sourcePkg) continue;
      copyPackageTree(sourcePkg, destPkg);
      hydrated += 1;
    }
  }
  return hydrated;
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
    const target = join(storeRoot, ...pkgName.split('/'));
    if (!existsSync(target)) continue;

    const linkPath = join(nodeModulesDir, ...pkgName.split('/'));
    if (existsSync(linkPath)) continue;

    ensureDirSymlink(linkPath, target);
    linked += 1;
  }

  return linked;
}

/**
 * npm pack/install does not preserve symlinks. Copy traced packages to
 * top-level `node_modules/<pkg>` so Node can resolve them without NODE_PATH.
 */
export function materializeTopLevelNodeModules(nodeModulesDir: string): number {
  const bunDir = join(nodeModulesDir, '.bun');
  if (!existsSync(bunDir)) return 0;

  let materialized = 0;
  for (const entry of readdirSync(bunDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pkgName = bunFolderToPackageName(entry.name);
    const source = join(bunDir, entry.name, 'node_modules', ...pkgName.split('/'));
    if (!existsSync(source) || !packageEntryExists(source)) continue;

    const dest = join(nodeModulesDir, ...pkgName.split('/'));
    if (existsSync(dest)) {
      try {
        if (!lstatSync(dest).isSymbolicLink()) continue;
        rmSync(dest, { recursive: true, force: true });
      } catch {
        continue;
      }
    }

    copyPackageTree(source, dest);
    materialized += 1;
  }

  return materialized;
}
