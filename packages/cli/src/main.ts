import chalk from 'chalk';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { superviseChildren } from './start-supervisor.js';
import { maybeLoadTeam } from '@ujima/runtime-core';
import { DEFAULT_BIND_HOST, DEFAULT_BIND_PORT } from '@ujima/api-schema';
import {
  findMonorepoRoot,
  resolvePackagedRuntimeDir,
  buildPackagedWebNodePath,
  resolveWebServerCwd,
  resolveWebServerEntry,
} from './runtime-paths.js';
import { compareVersions, getLocalVersion } from './version.js';
import {
  printCommandRow,
  printInfoRow,
  printReadyLine,
  printSplash,
} from './cli-branding.js';
import { maybeOpenBrowserAfterStart } from './open-browser.js';

export { compareVersions, getLocalVersion } from './version.js';

function resolveHomeDir(): string {
  const fromEnv = process.env.UJIMA_HOME;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  return join(homedir(), '.ujima');
}

function loadToken(homeDir: string): string {
  const fromEnv = process.env.UJIMA_TOKEN;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  try {
    return readFileSync(join(homeDir, 'token'), 'utf8').trim();
  } catch {
    throw new Error(
      `ujima: no token found.\n` +
      `  The API daemon must be running to generate a token.\n` +
      `  Fix: Run 'ujima start' in a separate terminal, then run 'ujima init' here.\n` +
      `  Token location: ${join(homeDir, 'token')}`,
    );
  }
}

function baseUrl(): string {
  const host = process.env.UJIMA_BIND_HOST ?? DEFAULT_BIND_HOST;
  const port = process.env.UJIMA_PORT ?? String(DEFAULT_BIND_PORT);
  return `http://${host}:${port}`;
}

function promptHiddenInput(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('ujima init: -p - requires an interactive terminal');
  }

  return new Promise((resolve) => {
    process.stdout.write(prompt);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let password = '';
    let done = false;
    const cleanup = () => {
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      process.stdout.write('\n');
      resolve(password);
    };
    const abort = () => {
      if (done) return;
      done = true;
      cleanup();
      process.exit(1);
    };
    const onKeypress = (str: string, key?: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key?.ctrl && key.name === 'c') {
        abort();
        return;
      }
      if (key?.name === 'return' || key?.name === 'enter') {
        finish();
        return;
      }
      if (key?.name === 'backspace' || key?.name === 'delete') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (!key?.ctrl && !key?.meta && str.length > 0) {
        password += str;
        process.stdout.write('*');
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

function isDevMode(): boolean {
  return process.env.UJIMA_DEV === '1' || findMonorepoRoot(__dirname) !== null;
}

interface InitOptions {
  organizationName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  workspaceRoot: string;
  configPath?: string;
  providerKeys: Record<string, string>;
  promptPassword: boolean;
}

function parseInitArgs(argv: string[]): InitOptions {
  const result: Partial<InitOptions> & { providerKeys: Record<string, string> } = {
    providerKeys: {},
    promptPassword: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`ujima init: missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case '--name':
      case '-n':
        result.organizationName = next();
        break;
      case '--owner':
      case '-o':
        result.ownerName = next();
        break;
      case '--owner-email':
      case '-e':
        result.ownerEmail = next();
        break;
      case '--owner-password':
      case '-p': {
        const value = next();
        if (value === '-') {
          result.promptPassword = true;
        } else {
          result.ownerPassword = value;
        }
        break;
      }
      case '--prompt-password':
        result.promptPassword = true;
        break;
      case '--workspace':
      case '-w':
        result.workspaceRoot = resolve(next());
        if (!existsSync(result.workspaceRoot)) {
          throw new Error(`ujima init: workspace path does not exist: ${result.workspaceRoot}`);
        }
        break;
      case '--config':
      case '-c':
        result.configPath = resolve(next());
        break;
      case '--provider': {
        const spec = next();
        const eq = spec.indexOf('=');
        if (eq <= 0) {
          throw new Error(`ujima init: --provider expects name=key, got "${spec}"`);
        }
        result.providerKeys[spec.slice(0, eq)] = spec.slice(eq + 1);
        break;
      }
      default:
        throw new Error(`ujima init: unknown argument "${arg}"`);
    }
  }
  if (!result.organizationName) throw new Error('ujima init: --name is required');
  if (!result.ownerName) throw new Error('ujima init: --owner is required');
  if (!result.ownerEmail) throw new Error('ujima init: --owner-email is required');
  if (!result.promptPassword && !result.ownerPassword) {
    throw new Error('ujima init: --owner-password is required (use -p - to prompt securely)');
  }
  if (!result.workspaceRoot) throw new Error('ujima init: --workspace is required');
  return result as InitOptions;
}

async function cmdInit(argv: string[]): Promise<void> {
  const opts = parseInitArgs(argv);
  const homeDir = resolveHomeDir();
  const token = loadToken(homeDir);

  let ownerPassword = opts.ownerPassword;
  if (opts.promptPassword) {
    ownerPassword = await promptHiddenInput('Owner password (min 8 chars): ');
  }

  const team = await maybeLoadTeam(opts.configPath);
  const teamPayload = team
    ? {
        name: team.config.name,
        agents: team.config.agents,
        roles: team.config.roles,
        channels: team.config.channels,
        providers: team.config.providers,
        organizationChart: team.config.organizationChart,
        policies: team.config.policies,
      }
    : {};

  const body = {
    organizationName: opts.organizationName,
    ownerName: opts.ownerName,
    ownerEmail: opts.ownerEmail,
    ownerPassword,
    workspaceRoot: opts.workspaceRoot,
    providerKeys: opts.providerKeys,
    team: teamPayload,
  };

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api/onboarding`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    process.stderr.write(
      `ujima init: cannot connect to API at ${baseUrl()}.\n` +
      `  Is 'ujima start' running in another terminal?\n` +
      `  Details: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  const text = await res.text();
  if (!res.ok) {
    process.stderr.write(`ujima init failed (${res.status}): ${text}\n`);
    process.exit(1);
  }
  process.stdout.write(`${text}\n`);
}

function parseStartArgv(argv: string[]) {
  const noOpen = argv.includes('--no-open');
  const passthrough = argv.filter((arg) => arg !== '--no-open');
  return { passthrough, noOpen };
}

async function cmdStartPackaged(runtimeDir: string, argv: string[]): Promise<void> {
  printSplash();
  const { passthrough } = parseStartArgv(argv);
  const apiEntry = join(runtimeDir, 'api', 'main.js');
  const webRuntimeDir = join(runtimeDir, 'web');
  const webEntry = resolveWebServerEntry(webRuntimeDir);
  if (!webEntry) {
    process.stderr.write(
      `ujima start: web server entry not found under ${webRuntimeDir}\n`,
    );
    process.exit(1);
  }

  const homeDir = resolveHomeDir();
  mkdirSync(homeDir, { recursive: true });
  const webPort = process.env.WEB_PORT ?? '3452';
  const webCwd = resolveWebServerCwd(webRuntimeDir, webEntry);

  printReadyLine('Starting Ujima');
  printInfoRow('Mode:', 'packaged API + web UI', { dim: true });

  const apiChild = spawn(process.execPath, [apiEntry, ...passthrough], {
    env: { ...process.env, UJIMA_HOME: homeDir },
    stdio: 'inherit',
  });

  const webChild = spawn(process.execPath, [webEntry], {
    cwd: webCwd,
    env: {
      ...process.env,
      UJIMA_HOME: homeDir,
      UJIMA_PORT: process.env.UJIMA_PORT ?? String(DEFAULT_BIND_PORT),
      PORT: webPort,
      HOSTNAME: process.env.WEB_HOST ?? '127.0.0.1',
      NODE_PATH: buildPackagedWebNodePath(webRuntimeDir, process.env.NODE_PATH),
    },
    stdio: 'inherit',
  });

  const supervised = [
    { child: apiChild, label: 'API' },
    { child: webChild, label: 'web UI' },
  ];

  maybeOpenBrowserAfterStart(argv);

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const { child } of supervised) {
      if (child.exitCode === null && !child.killed) child.kill(signal);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const exitCode = await superviseChildren(supervised, {
    isGracefulShutdown: () => shuttingDown,
  });
  process.exit(exitCode);
}

async function cmdStartMonorepo(root: string, argv: string[]): Promise<void> {
  const { passthrough } = parseStartArgv(argv);
  printSplash();
  printReadyLine('Starting Ujima');
  printInfoRow('Mode:', `monorepo dev (${root})`, { dim: true });

  maybeOpenBrowserAfterStart(argv);

  const child = spawn('bun', ['run', 'dev', ...passthrough], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env },
  });

  return new Promise<void>((resolvePromise) => {
    child.on('error', (err) => {
      process.stderr.write(`ujima start error: ${err.message}\n`);
      process.exit(1);
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        process.stdout.write(`\nujima start process terminated by signal ${signal}\n`);
        process.exit(128);
      }
      process.exit(code ?? 0);
      resolvePromise();
    });
  });
}

async function cmdStart(argv: string[]): Promise<void> {
  // Then the freshness prompt — never in dev mode (running from a repo
  // checkout) and never when running from a packaged self-update script.
  await maybeOfferUpdate(argv);

  const packagedRuntime = resolvePackagedRuntimeDir(__dirname);
  if (packagedRuntime) {
    await cmdStartPackaged(packagedRuntime, argv);
    return;
  }

  const root = findMonorepoRoot();
  if (!root) {
    process.stderr.write(
      'ujima start: no packaged runtime found and not inside the Ujima monorepo.\n' +
        'Install globally: npm install -g @ujima/agents\n' +
        'Or run from a clone of https://github.com/UjimaAgents/ujima-agents\n',
    );
    process.exit(1);
  }

  await cmdStartMonorepo(root, argv);
}

function printUsage(): void {
  const version = getLocalVersion();
  printSplash();
  printReadyLine(`Ujima CLI v${version}`);
  printInfoRow('Usage:', 'ujima <command> [options]');
  console.info(`   ${chalk.gray('↳')} ${chalk.white('Commands:')}`);
  printCommandRow('start', 'Start the local API daemon and web UI');
  printCommandRow('init', 'Onboard organization, owner, and workspace');
  printCommandRow('update', 'Check for and install CLI updates');
  printCommandRow('help', 'Display help for a command');
  printInfoRow('More:', 'ujima help <command>  |  ujima <command> --help', { dim: true });
  console.info(`   ${chalk.gray('↳')} ${chalk.white('Environment:')}`);
  printInfoRow('UJIMA_HOME', '~/.ujima', { dim: true });
  printInfoRow('UJIMA_TOKEN', '$UJIMA_HOME/token', { dim: true });
  printInfoRow('UJIMA_BIND_HOST', '127.0.0.1', { dim: true });
  printInfoRow('UJIMA_PORT', '7511', { dim: true });
  printInfoRow('WEB_PORT', '3452', { dim: true });
}

function printCommandHelp(cmd: string): void {
  printSplash();
  switch (cmd) {
    case 'start':
      printReadyLine('Command: start');
      printInfoRow('Usage:', 'ujima start [options]');
      printInfoRow(
        'Description:',
        'Start the local API daemon and web UI (packaged or monorepo dev).',
        { dim: true },
      );
      printInfoRow('Options:', '--no-open   Do not open the browser after the web UI is ready', {
        dim: true,
      });
      break;

    case 'init':
      printReadyLine('Command: init');
      printInfoRow('Usage:', 'ujima init [options]');
      printInfoRow(
        'Description:',
        'Onboard a new organization, owner, and workspace against a running API.',
        { dim: true },
      );
      printInfoRow(
        'Note:',
        'Run "ujima start" first (in a separate terminal) to start the API daemon, then run init.',
        { dim: true },
      );
      console.info(`   ${chalk.gray('↳')} ${chalk.white('Options:')}`);
      printInfoRow('--name, -n', 'Organization name (required)', { dim: true });
      printInfoRow('--owner, -o', 'Owner display name (required)', { dim: true });
      printInfoRow('--owner-email, -e', 'Owner email address (required)', { dim: true });
      printInfoRow('--owner-password, -p', 'Owner password (min 8 chars). Use -p - to prompt securely.', { dim: true });
      printInfoRow('--prompt-password', 'Prompt for password securely (hidden input)', { dim: true });
      printInfoRow('--workspace, -w', 'Workspace root path (required, must exist)', { dim: true });
      printInfoRow('--config, -c', 'Path to ujima.config.ts', { dim: true });
      printInfoRow('--provider', 'name=key (repeatable)', { dim: true });
      break;

    case 'update':
      printReadyLine('Command: update');
      printInfoRow('Usage:', 'ujima update [options]');
      printInfoRow('Description:', 'Check npm and install @ujima/agents updates.', { dim: true });
      console.info(`   ${chalk.gray('↳')} ${chalk.white('Options:')}`);
      printInfoRow('--check-only', 'Check without installing', { dim: true });
      printInfoRow('--force', 'Re-install even if up to date', { dim: true });
      break;

    default:
      process.stderr.write(`ujima help: unknown command "${cmd}"\n`);
      printUsage();
      process.exit(2);
  }
}

interface UpdateCheckCache {
  checkedAt: string;
  latest: string;
}

function updateCheckCachePath(): string {
  return join(resolveHomeDir(), 'update-check.json');
}

async function maybeOfferUpdate(argv: string[]): Promise<void> {
  if (isDevMode()) return;
  if (resolvePackagedRuntimeDir(__dirname) === null) return;
  if (argv.includes('--no-update-check')) return;
  const local = getLocalVersion();
  const latest = await fetchLatestVersionCached();
  if (!latest) return;
  if (compareVersions(latest, local) <= 0) return;
  process.stdout.write(
    `\nA new version of @ujima/agents is available: ${chalk.green(latest)} (installed: ${local}).\n`,
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer = 'y';
  try {
    answer = (await rl.question('Update now? [Y/n] ')).trim().toLowerCase();
  } finally {
    rl.close();
  }
  if (answer === 'n' || answer === 'no') return;
  await runNpmGlobalInstall(latest);
  process.stdout.write(`Updated to ${latest}. Re-running ujima start…\n`);
  // Re-exec the freshly-installed CLI with the original argv. The npm
  // install replaced our binary on disk; node's exec resolution will
  // pick up the new copy.
  const child = spawn(process.execPath, [process.argv[1] ?? 'ujima', 'start', ...argv], {
    stdio: 'inherit',
  });
  await new Promise<void>((resolveExit) => {
    child.on('exit', (code) => {
      process.exit(code ?? 0);
      resolveExit();
    });
  });
}

async function fetchLatestVersionCached(): Promise<string | null> {
  const cachePath = updateCheckCachePath();
  const TTL_MS = 24 * 60 * 60 * 1000;
  try {
    const raw = readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as UpdateCheckCache;
    const age = Date.now() - Date.parse(parsed.checkedAt);
    if (Number.isFinite(age) && age >= 0 && age < TTL_MS) return parsed.latest;
  } catch {
    // No cache; fall through.
  }
  try {
    const res = await fetch('https://registry.npmjs.org/@ujima/agents/latest', {
      headers: { 'user-agent': 'ujima-cli-update-check' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    if (typeof data.version !== 'string') return null;
    mkdirSync(resolveHomeDir(), { recursive: true });
    const next: UpdateCheckCache = {
      checkedAt: new Date().toISOString(),
      latest: data.version,
    };
    try {
      writeFileSync(cachePath, JSON.stringify(next, null, 2));
    } catch {
      // best-effort cache write
    }
    return data.version;
  } catch {
    return null;
  }
}

async function runNpmGlobalInstall(version: string): Promise<void> {
  await new Promise<void>((resolveExit, rejectExit) => {
    const child = spawn('npm', ['install', '-g', `@ujima/agents@${version}`], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', (err) => rejectExit(err));
    child.on('exit', (code) => {
      if (code === 0) resolveExit();
      else rejectExit(new Error(`npm install exited ${code ?? 'null'}`));
    });
  });
}

async function cmdUpdate(argv: string[]): Promise<void> {
  const checkOnly = argv.includes('--check-only');
  const force = argv.includes('--force');

  const localVersion = getLocalVersion();
  process.stdout.write(`Current version: v${localVersion}\n`);
  process.stdout.write('Checking npm registry for updates…\n');

  let latestVersion = '';
  try {
    const res = await fetch('https://registry.npmjs.org/@ujima/agents/latest', {
      headers: { 'User-Agent': 'ujima-cli-update' },
    });
    if (!res.ok) {
      throw new Error(`Registry returned status ${res.status}`);
    }
    const data = (await res.json()) as { version: string };
    latestVersion = data.version;
  } catch (err) {
    process.stderr.write(
      `ujima update: Failed to contact the npm registry. Ensure you have an internet connection.\n` +
        `Details: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`Latest version available: v${latestVersion}\n`);

  const isNewer = compareVersions(latestVersion, localVersion) > 0;

  if (!isNewer && !force) {
    process.stdout.write('Ujima Agents CLI is already up-to-date!\n');
    return;
  }

  if (isNewer) {
    process.stdout.write(`\nA new version of Ujima Agents is available: v${latestVersion} (installed: v${localVersion})\n`);
  } else if (force) {
    process.stdout.write('\nForce-update requested.\n');
  }

  if (checkOnly) {
    process.stdout.write("Run 'ujima update' to install the latest version.\n");
    return;
  }

  const monorepoRoot = findMonorepoRoot(__dirname);
  if (monorepoRoot) {
    process.stdout.write(
      `ujima update: You are running the CLI in monorepo development mode (${monorepoRoot}).\n` +
        `Skipping global self-update to avoid clobbering development builds. Run 'bun run build' or updates locally.\n`,
    );
    return;
  }

  process.stdout.write(`Updating Ujima Agents globally to v${latestVersion} via npm…\n`);

  const child = spawn('npm', ['install', '-g', `@ujima/agents@${latestVersion}`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  return new Promise<void>((resolvePromise) => {
    child.on('error', (err) => {
      process.stderr.write(
        `ujima update error: failed to execute npm install. Details: ${err.message}\n` +
          `Please run: npm install -g @ujima/agents\n`,
      );
      process.exit(1);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        process.stdout.write(`\nSuccessfully updated Ujima Agents to v${latestVersion}!\n`);
        resolvePromise();
      } else {
        process.stderr.write(
          `\nnpm install exited with error code ${code}.\n` +
            `If this is a permission error, please run:\n` +
            `  ${process.platform === 'win32' ? 'Start a terminal as Administrator and run: npm install -g @ujima/agents' : 'sudo npm install -g @ujima/agents'}\n`,
        );
        process.exit(code ?? 1);
      }
    });
  });
}

export async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  // Handle global help
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    if (command === 'help' && rest[0]) {
      printCommandHelp(rest[0]);
    } else {
      printUsage();
    }
    return;
  }

  // Handle command-specific help like: ujima start --help, ujima start -h
  if (rest.includes('--help') || rest.includes('-h')) {
    printCommandHelp(command);
    return;
  }

  switch (command) {
    case 'start':
      await cmdStart(rest);
      return;
    case 'init':
      await cmdInit(rest);
      return;
    case 'update':
      await cmdUpdate(rest);
      return;
    default:
      process.stderr.write(`ujima: unknown command "${command}"\n`);
      printUsage();
      process.exit(2);
  }
}
