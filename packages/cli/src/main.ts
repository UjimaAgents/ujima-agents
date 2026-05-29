import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
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
      `ujima: no token found. Set UJIMA_TOKEN or start the runtime to generate ${join(homeDir, 'token')}.`,
    );
  }
}

function baseUrl(): string {
  const host = process.env.UJIMA_BIND_HOST ?? DEFAULT_BIND_HOST;
  const port = process.env.UJIMA_PORT ?? String(DEFAULT_BIND_PORT);
  return `http://${host}:${port}`;
}

interface InitOptions {
  organizationName: string;
  ownerName: string;
  workspaceRoot: string;
  configPath?: string;
  providerKeys: Record<string, string>;
}

function parseInitArgs(argv: string[]): InitOptions {
  const result: Partial<InitOptions> & { providerKeys: Record<string, string> } = {
    providerKeys: {},
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
      case '--workspace':
      case '-w':
        result.workspaceRoot = resolve(next());
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
  if (!result.workspaceRoot) throw new Error('ujima init: --workspace is required');
  return result as InitOptions;
}

async function cmdInit(argv: string[]): Promise<void> {
  const opts = parseInitArgs(argv);
  const homeDir = resolveHomeDir();
  const token = loadToken(homeDir);

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
    workspaceRoot: opts.workspaceRoot,
    providerKeys: opts.providerKeys,
    team: teamPayload,
  };

  const res = await fetch(`${baseUrl()}/api/onboarding`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    process.stderr.write(`ujima init failed (${res.status}): ${text}\n`);
    process.exit(1);
  }
  process.stdout.write(`${text}\n`);
}

async function cmdStartPackaged(runtimeDir: string, argv: string[]): Promise<void> {
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

  process.stdout.write('ujima start: launching packaged API and web UI…\n\n');

  const apiChild = spawn(process.execPath, [apiEntry, ...argv], {
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
  process.stdout.write(
    `ujima start: Found monorepo at ${root}\nStarting stack with 'bun run dev'…\n\n`,
  );

  const child = spawn('bun', ['run', 'dev', ...argv], {
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
  process.stdout.write(
    [
      `Ujima Agents CLI v${version} — Build and run teams of autonomous AI agents.`,
      '',
      'Usage: ujima <command> [options]',
      '',
      'Commands:',
      '  start   Start the local API daemon and web UI',
      '  init    Onboard a new organization, owner, and workspace',
      '  update  Check for and install updates to Ujima Agents CLI',
      '  help    Display help information for a command',
      '',
      "Run 'ujima help <command>' or 'ujima <command> --help' to see detailed options for a specific command.",
      '',
      'Environment:',
      '  UJIMA_HOME       Runtime home dir (default: ~/.ujima)',
      '  UJIMA_TOKEN      Bearer token (default: read from $UJIMA_HOME/token)',
      '  UJIMA_BIND_HOST  Daemon host (default: 127.0.0.1)',
      '  UJIMA_PORT       Daemon port (default: 7511)',
      '  WEB_PORT         Web UI port when using packaged start (default: 3452)',
      '',
    ].join('\n'),
  );
}

function printCommandHelp(cmd: string): void {
  switch (cmd) {
    case 'start':
      process.stdout.write(
        [
          'Usage: ujima start [options]',
          '',
          'Start the local Ujima stack, launching both the API daemon and the web UI processes.',
          '',
          'Options:',
          '  None (takes default environment configuration)',
          '',
          'Environment Variables:',
          '  UJIMA_HOME        Runtime data home directory (default: ~/.ujima)',
          '  UJIMA_PORT        Daemon API port (default: 7511)',
          '  UJIMA_BIND_HOST   Daemon API host interface (default: 127.0.0.1)',
          '  WEB_PORT          Web UI port when using packaged start (default: 3452)',
          '  WEB_HOST          Web UI host interface when using packaged start (default: 127.0.0.1)',
          '',
        ].join('\n'),
      );
      break;

    case 'init':
      process.stdout.write(
        [
          'Usage: ujima init [options]',
          '',
          'Run first-run onboarding against a running Ujima API daemon to configure a new organization, owner, and workspace.',
          '',
          'Options:',
          '  --name, -n <name>         Organization name (required)',
          '  --owner, -o <name>        Owner display name (required)',
          '  --workspace, -w <path>    Absolute path to workspace root (required)',
          '  --config, -c <path>       Path to ujima.config.ts configuration file (defaults to ./ujima.config.ts)',
          '  --provider <name=key>     LLM provider API key to configure (repeatable, e.g. --provider openai=sk-...)',
          '',
          'Example:',
          '  ujima init --name "Acme Corp" --owner "Alice Smith" --workspace /Users/alice/projects/acme',
          '',
        ].join('\n'),
      );
      break;

    case 'update':
      process.stdout.write(
        [
          'Usage: ujima update [options]',
          '',
          'Check for updates to the Ujima Agents CLI (@ujima/agents) on the npm registry, compare with the currently installed version, and automatically update if a newer version is found.',
          '',
          'Options:',
          '  --check-only              Only check for updates and print the status without executing the update',
          '  --force                   Force re-installation/update even if already up-to-date',
          '',
        ].join('\n'),
      );
      break;

    default:
      process.stderr.write(`ujima help: unknown command "${cmd}"\n`);
      printUsage();
      process.exit(2);
  }
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
            `  sudo npm install -g @ujima/agents\n`,
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

