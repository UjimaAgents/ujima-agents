import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { prepareTracedStandaloneNodeModules } from './materialize-web-deps.ts';
import { REPO_ROOT } from './paths.ts';

describe('prepareTracedStandaloneNodeModules', () => {
  it('keeps Bun traced store and does not require top-level next', async () => {
    const standaloneSrc = join(REPO_ROOT, 'apps/web/.next/standalone');
    if (!existsSync(join(standaloneSrc, 'node_modules/.bun'))) {
      return;
    }

    const workDir = mkdtempSync(join(tmpdir(), 'ujima-traced-'));
    cpSync(standaloneSrc, workDir, { recursive: true });

    await prepareTracedStandaloneNodeModules(workDir);

    expect(existsSync(join(workDir, 'node_modules/.bun'))).toBe(true);
    expect(existsSync(join(workDir, 'node_modules/next'))).toBe(false);

    rmSync(workDir, { recursive: true, force: true });
  });
});
