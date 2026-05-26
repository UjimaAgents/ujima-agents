import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findMonorepoRoot,
  resolvePackagedRuntimeDir,
  resolveWebServerCwd,
  resolveWebServerEntry,
} from './runtime-paths.js';

describe('runtime-paths', () => {
  it('findMonorepoRoot skips packages/distribution and resolves workspace root', () => {
    const root = join(tmpdir(), `ujima-repo-${Date.now()}`);
    const distPkg = join(root, 'packages', 'distribution');
    mkdirSync(distPkg, { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'ujima-agents', private: true, workspaces: ['packages/*'] }),
    );
    writeFileSync(join(root, 'turbo.json'), '{}');
    writeFileSync(join(root, 'bun.lock'), '');
    writeFileSync(
      join(distPkg, 'package.json'),
      JSON.stringify({ name: '@ujima/distribution', version: '0.1.0' }),
    );

    expect(findMonorepoRoot(distPkg)).toBe(root);
    expect(findMonorepoRoot(join(root, 'packages', 'cli'))).toBe(root);
    rmSync(root, { recursive: true, force: true });
  });

  it('detects packaged runtime when api main exists', () => {
    const root = join(tmpdir(), `ujima-runtime-${Date.now()}`);
    const cliDir = join(root, 'dist');
    const apiDir = join(cliDir, 'runtime', 'api');
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, 'main.js'), '// stub\n');
    expect(resolvePackagedRuntimeDir(cliDir)).toBe(join(cliDir, 'runtime'));
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves monorepo-style Next standalone server path', () => {
    const root = join(tmpdir(), `ujima-web-${Date.now()}`);
    const server = join(root, 'apps/web/server.js');
    mkdirSync(join(root, 'apps/web'), { recursive: true });
    writeFileSync(server, '// stub\n');
    expect(resolveWebServerEntry(root)).toBe(server);
    expect(resolveWebServerCwd(root, server)).toBe(join(root, 'apps/web'));
    rmSync(root, { recursive: true, force: true });
  });
});
