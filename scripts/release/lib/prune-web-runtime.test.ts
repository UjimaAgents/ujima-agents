import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { pruneWebRuntimeNodeModules } from './prune-web-runtime.ts';

describe('pruneWebRuntimeNodeModules', () => {
  it('removes docs, types, maps, and test artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'ujima-prune-'));
    const nodeModules = join(root, 'node_modules');
    const nextDocs = join(nodeModules, 'next', 'dist', 'docs');
    const pkgTests = join(nodeModules, 'pkg', '__tests__');

    mkdirSync(nextDocs, { recursive: true });
    writeFileSync(join(nextDocs, 'index.md'), '# docs');
    mkdirSync(pkgTests, { recursive: true });
    writeFileSync(join(pkgTests, 'a.test.js'), 'test');
    writeFileSync(join(nodeModules, 'pkg', 'index.js'), 'module.exports = {}');
    writeFileSync(join(nodeModules, 'pkg', 'index.d.ts'), 'export {}');
    writeFileSync(join(nodeModules, 'pkg', 'bundle.js.map'), '{}');

    const stats = pruneWebRuntimeNodeModules(nodeModules);

    expect(stats.files).toBeGreaterThan(0);
    expect(existsSync(join(nextDocs, 'index.md'))).toBe(false);
    expect(existsSync(join(pkgTests, 'a.test.js'))).toBe(false);
    expect(existsSync(join(nodeModules, 'pkg', 'index.d.ts'))).toBe(false);
    expect(existsSync(join(nodeModules, 'pkg', 'bundle.js.map'))).toBe(false);
    expect(existsSync(join(nodeModules, 'pkg', 'index.js'))).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});
