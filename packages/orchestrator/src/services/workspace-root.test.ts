import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertWorkspaceRootPathExists } from './workspace-root.js';

describe('assertWorkspaceRootPathExists', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('rejects blank paths without resolving to cwd', () => {
    expect(() => assertWorkspaceRootPathExists('')).toThrow(/project folder is required/);
    expect(() => assertWorkspaceRootPathExists('   ')).toThrow(/project folder is required/);
  });

  it('returns a resolved path when the folder exists', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ujima-root-'));
    expect(assertWorkspaceRootPathExists(tempDir)).toBe(tempDir);
  });

  it('rejects paths that do not exist on disk', () => {
    expect(() =>
      assertWorkspaceRootPathExists(join(tmpdir(), 'ujima-missing-root-never-created')),
    ).toThrow(/does not exist on disk/);
  });
});
