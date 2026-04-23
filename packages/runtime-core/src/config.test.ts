import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { resolveTeamConfigPath } from './config.js';

const originalCwd = process.cwd();
const originalTeamConfigEnv = process.env.UJIMA_TEAM_CONFIG;
const originalLegacyConfigEnv = process.env.UJIMA_CONFIG_FILE;
const tempDirs: string[] = [];

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalTeamConfigEnv === undefined) {
    delete process.env.UJIMA_TEAM_CONFIG;
  } else {
    process.env.UJIMA_TEAM_CONFIG = originalTeamConfigEnv;
  }
  if (originalLegacyConfigEnv === undefined) {
    delete process.env.UJIMA_CONFIG_FILE;
  } else {
    process.env.UJIMA_CONFIG_FILE = originalLegacyConfigEnv;
  }

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('resolveTeamConfigPath prefers UJIMA_TEAM_CONFIG over workspace defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ujima-config-'));
  tempDirs.push(dir);
  const explicitPath = join(dir, 'custom.config.js');
  await writeFile(explicitPath, 'export default {};\n', 'utf8');
  await writeFile(join(dir, 'ujima.config.ts'), 'export default {};\n', 'utf8');

  process.env.UJIMA_TEAM_CONFIG = explicitPath;
  process.chdir(dir);

  expect(resolveTeamConfigPath()).toBe(resolve(explicitPath));
});

test('resolveTeamConfigPath falls back from ujima.config.ts to ujima.config.js', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ujima-config-'));
  tempDirs.push(dir);
  const jsPath = join(dir, 'ujima.config.js');
  await writeFile(jsPath, 'export default {};\n', 'utf8');

  delete process.env.UJIMA_TEAM_CONFIG;
  delete process.env.UJIMA_CONFIG_FILE;
  process.chdir(dir);

  expect(basename(resolveTeamConfigPath() ?? '')).toBe('ujima.config.js');
});
