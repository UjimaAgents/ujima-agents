import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { prepareTracedStandaloneNodeModules } from './materialize-web-deps.ts';
import { packageEntryExists } from './repair-standalone-node-modules.ts';
import { REPO_ROOT } from './paths.ts';

describe('prepareTracedStandaloneNodeModules', () => {
  it('hydrates traced stubs and materializes top-level packages', async () => {
    const standaloneSrc = join(REPO_ROOT, 'apps/web/.next/standalone');
    if (!existsSync(join(standaloneSrc, 'node_modules/.bun'))) {
      return;
    }

    const workDir = mkdtempSync(join(tmpdir(), 'ujima-traced-'));
    cpSync(standaloneSrc, workDir, { recursive: true });

    await prepareTracedStandaloneNodeModules(workDir, REPO_ROOT);

    expect(existsSync(join(workDir, 'node_modules/.bun'))).toBe(true);
    expect(existsSync(join(workDir, 'node_modules/next'))).toBe(true);

    const react18 = join(workDir, 'node_modules/.bun/react@18.3.1/node_modules/react');
    if (existsSync(react18)) {
      expect(packageEntryExists(react18)).toBe(true);
    }

    rmSync(workDir, { recursive: true, force: true });
  });
});
