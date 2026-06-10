import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  bunFolderToPackageName,
  hydrateTracedBunStorePackages,
  packageEntryExists,
} from './repair-standalone-node-modules.ts';
import { REPO_ROOT } from './paths.ts';

describe('packageEntryExists', () => {
  it('returns false for package.json-only stubs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ujima-pkg-stub-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'react', main: 'index.js' }));
    expect(packageEntryExists(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('hydrateTracedBunStorePackages', () => {
  it('copies full package trees for traced stubs', () => {
    const standaloneSrc = join(REPO_ROOT, 'apps/web/.next/standalone');
    if (!existsSync(join(standaloneSrc, 'node_modules/.bun/react@18.3.1'))) {
      return;
    }

    const workDir = mkdtempSync(join(tmpdir(), 'ujima-hydrate-'));
    const nodeModules = join(workDir, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    cpSync(join(standaloneSrc, 'node_modules/.bun'), join(nodeModules, '.bun'), {
      recursive: true,
    });

    const hydrated = hydrateTracedBunStorePackages(nodeModules, REPO_ROOT);
    expect(hydrated).toBeGreaterThan(0);
    expect(
      existsSync(join(nodeModules, '.bun/react@18.3.1/node_modules/react/index.js')),
    ).toBe(true);

    rmSync(workDir, { recursive: true, force: true });
  });
});

describe('bunFolderToPackageName', () => {
  it('maps plain package folders', () => {
    expect(bunFolderToPackageName('next@16.2.4+d84480edb43e4669')).toBe('next');
  });

  it('maps scoped package folders', () => {
    expect(bunFolderToPackageName('@next+env@16.2.4')).toBe('@next/env');
    expect(bunFolderToPackageName('@swc+helpers@0.5.15')).toBe('@swc/helpers');
  });
});
