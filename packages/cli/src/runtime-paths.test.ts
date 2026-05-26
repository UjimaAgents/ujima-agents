import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolvePackagedRuntimeDir,
  resolveWebServerCwd,
  resolveWebServerEntry,
} from './runtime-paths.js';

describe('runtime-paths', () => {
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
