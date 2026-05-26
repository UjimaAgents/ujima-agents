import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPathResolver, PathEscapeError } from './path-resolver.js';

describe('PathResolver', () => {
  let root: string;
  let outside: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ujima-pr-root-'));
    outside = await mkdtemp(join(tmpdir(), 'ujima-pr-out-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'x');
    await writeFile(join(outside, 'secret.txt'), 'leak');
  });

  it('resolves a path inside root', async () => {
    const r = await createPathResolver({ root });
    const resolved = await r.resolve(join(root, 'src', 'a.ts'));
    expect(resolved).toContain('src');
  });

  it('resolves a not-yet-created path under its parent', async () => {
    const r = await createPathResolver({ root });
    const canonicalRoot = await realpath(root);
    const resolved = await r.resolve(join(root, 'new', 'file.ts'));
    expect(resolved).toBe(join(canonicalRoot, 'new', 'file.ts'));
  });

  it('rejects ../ escape', async () => {
    const r = await createPathResolver({ root });
    await expect(r.resolve(join(root, '..', 'secret.txt'))).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('rejects absolute path outside root', async () => {
    const r = await createPathResolver({ root });
    await expect(r.resolve(join(outside, 'secret.txt'))).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('rejects symlink that points outside root', async () => {
    const linkPath = join(root, 'evil-link');
    try {
      await symlink(outside, linkPath);
    } catch {
      return;
    }
    const r = await createPathResolver({ root });
    await expect(r.resolve(join(linkPath, 'secret.txt'))).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('enforces scope paths when provided', async () => {
    const r = await createPathResolver({ root, scopePaths: ['src'] });
    await expect(r.resolve(join(root, 'src', 'a.ts'))).resolves.toContain('src');
    await expect(r.resolve(join(root, 'other.ts'))).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('describes scope violations separately from workspace root escape', async () => {
    const r = await createPathResolver({ root, scopePaths: ['src'] });
    await expect(r.resolve(join(root, 'other.ts'))).rejects.toMatchObject({
      reason: 'scope',
    });
    await expect(r.resolve(join(root, 'other.ts'))).rejects.toThrow(
      /outside allowed scope\(s\)/,
    );
    await expect(r.resolve(join(outside, 'secret.txt'))).rejects.toMatchObject({
      reason: 'workspace',
    });
  });

  it('preserves missing scope boundaries instead of broadening to the parent subtree', async () => {
    const r = await createPathResolver({ root, scopePaths: ['src/generated'] });
    const canonicalRoot = await realpath(root);
    await expect(r.resolve(join(root, 'src', 'generated', 'new.ts'))).resolves.toBe(
      join(canonicalRoot, 'src', 'generated', 'new.ts'),
    );
    await expect(r.resolve(join(root, 'src', 'a.ts'))).rejects.toBeInstanceOf(PathEscapeError);
  });
});
