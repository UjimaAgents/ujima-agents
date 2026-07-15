import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const rootDir = resolve(import.meta.dir, '..');
const username = process.env.USERNAME || process.env.USER || 'dev';
const isolatedHome = process.env.UJIMA_HOME || join(homedir(), `.ujima-local-${username}`);
const localTeamConfig = resolve(rootDir, 'ujima.config.ts');

const env: NodeJS.ProcessEnv = {
  ...process.env,
  UJIMA_HOME: isolatedHome,
};

if (!env.UJIMA_TEAM_CONFIG && existsSync(localTeamConfig)) {
  env.UJIMA_TEAM_CONFIG = localTeamConfig;
}

if (!env.UJIMA_CONFIG_FILE && existsSync(localTeamConfig)) {
  env.UJIMA_CONFIG_FILE = localTeamConfig;
}

mkdirSync(isolatedHome, { recursive: true });

const extraArgs = process.argv.slice(2);
const command = [process.execPath, 'run', 'dev', ...extraArgs];

console.log('[dev-isolated] Starting isolated dev environment');
console.log(`[dev-isolated] UJIMA_HOME=${env.UJIMA_HOME}`);
if (env.UJIMA_TEAM_CONFIG) {
  console.log(`[dev-isolated] UJIMA_TEAM_CONFIG=${env.UJIMA_TEAM_CONFIG}`);
}

const child = Bun.spawn(command, {
  cwd: rootDir,
  env,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});

const exitCode = await child.exited;
process.exit(exitCode);
