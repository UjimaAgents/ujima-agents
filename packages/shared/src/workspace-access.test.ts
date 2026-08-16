import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveWorkspaceAccess } from './workspace-access.js';

describe('resolveWorkspaceAccess', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('uses the same hard scope decision for reads and writes', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-access-'));
    await mkdir(join(root, 'apps', 'web'), { recursive: true });
    await writeFile(join(root, 'apps', 'web', 'index.ts'), 'ok');

    expect(resolveWorkspaceAccess({
      workspaceRoot: root,
      roleScopes: ['apps/web'],
      resourcePath: join(root, 'apps', 'web', 'index.ts'),
      operation: 'read',
    }).allowed).toBe(true);
    expect(resolveWorkspaceAccess({
      workspaceRoot: root,
      roleScopes: ['apps/web'],
      resourcePath: join(root, 'README.md'),
      operation: 'write',
    })).toMatchObject({ allowed: false });
  });

  it('denies file access when a role has no declared scope', async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-access-'));
    expect(resolveWorkspaceAccess({
      workspaceRoot: root,
      roleScopes: [],
      resourcePath: root,
      operation: 'read',
    })).toMatchObject({ allowed: false });
  });
});
