#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { maybeLoadTeam } from '@ujima/runtime-core';
import { DEFAULT_BIND_HOST, DEFAULT_BIND_PORT } from '@ujima/api-schema';

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

function printUsage(): void {
  process.stdout.write(
    [
      'Usage: ujima <command> [options]',
      '',
      'Commands:',
      '  init   Run first-run onboarding against a running daemon',
      '',
      'init options:',
      '  --name, -n <name>         Organization name (required)',
      '  --owner, -o <name>        Owner display name (required)',
      '  --workspace, -w <path>    Absolute workspace root (required)',
      '  --config, -c <path>       Path to ujima.config.ts (defaults to $UJIMA_CONFIG_FILE or ./ujima.config.ts)',
      '  --provider <name=key>     Provider API key (repeatable)',
      '',
      'Environment:',
      '  UJIMA_HOME       Runtime home dir (default: ~/.ujima)',
      '  UJIMA_TOKEN      Bearer token (default: read from $UJIMA_HOME/token)',
      '  UJIMA_BIND_HOST  Daemon host (default: 127.0.0.1)',
      '  UJIMA_PORT       Daemon port (default: 7511)',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }
  switch (command) {
    case 'init':
      await cmdInit(rest);
      return;
    default:
      process.stderr.write(`ujima: unknown command "${command}"\n`);
      printUsage();
      process.exit(2);
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`ujima: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
