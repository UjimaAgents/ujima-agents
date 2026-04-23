#!/usr/bin/env node
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import {
  createFileSecretStore,
  createJsonLogger,
  createRuntimeHost,
  Repository,
} from '@ujima/runtime-core';
import type { AgentDef, MCPDef, TeamDef } from '@ujima/shared';
import type { LLMProvider } from '@ujima/llm/legacy';
import {
  createApiServices,
  createTeamStore,
  type PermissionContextBuilder,
} from '@ujima/orchestrator';
import { createTransport } from './transport/server.js';
import { ensureBearerToken } from './transport/token.js';
import { DEFAULT_BIND_HOST, DEFAULT_BIND_PORT } from '@ujima/api-schema';
import { startTeamConfigWatcher } from './config-sync.js';

const STARTUP_SPLASH = `
   █  █   █ █ █▀▄▀█ █▀█
   █  █   █ █ █ ▀ █ █▀█
   ▀▀▀  ▀▀▀ ▀ ▀   ▀ ▀ ▀
   A G E N T  S Y S T E M
`;

function resolveHomeDir(): string {
  const fromEnv = process.env.UJIMA_HOME;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  return join(homedir(), '.ujima');
}

const DIRTY_FLAG_NAME = 'runtime.dirty';

function writeDirtyFlag(homeDir: string): void {
  try {
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(join(homeDir, DIRTY_FLAG_NAME), String(process.pid), 'utf8');
  } catch {
    // best-effort — if we can't write the flag, startup will still proceed
  }
}

function clearDirtyFlag(homeDir: string): void {
  try {
    unlinkSync(join(homeDir, DIRTY_FLAG_NAME));
  } catch {
    // file may not exist — that's fine
  }
}

function wasDirtyShutdown(homeDir: string): boolean {
  return existsSync(join(homeDir, DIRTY_FLAG_NAME));
}

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.UJIMA_PORT ?? String(DEFAULT_BIND_PORT), 10);
  try {
    const pids = execSync(`lsof -t -i:${port}`).toString().trim().split('\n');
    for (const pid of pids) {
      if (pid) process.kill(Number(pid), 'SIGKILL');
    }
  } catch (error) {
    void error;
  }

  const homeDir = resolveHomeDir();
  mkdirSync(homeDir, { recursive: true });
  const logger = createJsonLogger({
    write: (line: string) => {
      if (process.env.NODE_ENV === 'production') {
        process.stderr.write(line + '\n');
      } else {
        const log = JSON.parse(line);
        const time = chalk.dim(new Date(log.ts).toLocaleTimeString());
        const level = log.level === 'error' ? chalk.red(log.level) : log.level === 'warn' ? chalk.yellow(log.level) : chalk.blue(log.level);
        const msg = chalk.white(log.message);
        const comp = chalk.magenta(`[${log.component || 'sys'}]`);
        process.stderr.write(`${time} ${level} ${comp} ${msg}\n`);
      }
    },
    level: (process.env.UJIMA_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info',
    baseFields: { component: 'runtime' },
  });

  if (wasDirtyShutdown(homeDir)) {
    const prevPid = safeReadPid(join(homeDir, DIRTY_FLAG_NAME));
    logger.warn('runtime: recovering from dirty shutdown', { previousPid: prevPid });
  }
  writeDirtyFlag(homeDir);

  const host = await createRuntimeHost(
    {
      homeDir,
      logger,
      // TODO(12.1): wire real loaders from file-backed workspace catalog once
      // the transport surface (12.1 stub) lands. These throw by default so
      // callers know the daemon is inert until configured.
      loadAgent: async (): Promise<AgentDef | undefined> => undefined,
      loadTeam: async (): Promise<TeamDef | undefined> => undefined,
      resolveMCPDef: async (_wsId, mcpId): Promise<MCPDef> => {
        throw new Error(`runtime: no MCP resolver configured (requested "${mcpId}")`);
      },
      getProvider: (agent: AgentDef): LLMProvider => {
        throw new Error(`runtime: no provider configured for agent "${agent.id}"`);
      },
    },
    {},
  );

  const token = ensureBearerToken(homeDir);
  const bindHost = process.env.UJIMA_BIND_HOST ?? DEFAULT_BIND_HOST;


  const secretStore = createFileSecretStore({ homeDir });
  const repository = new Repository(host.db.raw, secretStore);
  const teamStore = createTeamStore();
  const teamConfigWatcher = await startTeamConfigWatcher({
    repo: repository,
    teamStore,
    logger,
  });

  // Map the orchestrator's tool-invocation shape into the permissions
  // middleware's agent-scoped shape. The `AgentDef` here is synthesised
  // because the framework's `AgentConfig` and shared `AgentDef` are
  // different schemas; we populate allowed_tools from the role's tool
  // list so the permissions middleware has real role-scoped data to
  // gate on.
  const buildPermissionContext: PermissionContextBuilder = (input) => {
    const team = teamStore.getTeam();
    const member = repository.getMember(input.organizationId, input.memberId);
    const role = team && member ? team.getRole(member.roleName) : undefined;
    const agentConfig = team
      ? (team.getAgent(input.memberId) ??
        (member ? team.getAgent(member.name) : undefined))
      : undefined;

    return {
      agent: {
        id: input.memberId,
        name: agentConfig?.name ?? input.memberId,
        persona: agentConfig?.personalityName ?? '',
        model: role?.model ?? '',
        mcp: input.toolId,
        permissions: {
          allowed_tools: role?.tools ?? [],
          blocked_tools: [],
          rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
        },
        communication: { publishes: [], subscribes: [] },
        escalation: { conditions: [], escalate_to: 'human' },
      },
      mcp: { id: input.toolId },
      toolName: input.toolId,
      args: input.input,
      taskId: input.runId,
      sessionId: input.runId,
    };
  };

  const transport = createTransport({
    host,
    token,
    logger: logger.child({ component: 'transport' }),
    bindHost,
    port,
    tlsCertPath: process.env.UJIMA_TLS_CERT,
    tlsKeyPath: process.env.UJIMA_TLS_KEY,
    apiServices: {
      repo: repository,
      buildServices: (realtime) =>
        createApiServices({
          teamStore,
          repo: repository,
          realtime,
          permissions: host.permissions,
          buildPermissionContext,
        }),
    },
  });
  await transport.listen();

  console.log(chalk.cyan(STARTUP_SPLASH));
  console.log(`   ${chalk.green('✓')} ${chalk.bold('System Ready')}`);
  console.log(`   ${chalk.gray('↳')} ${chalk.white('API:')}         ${chalk.cyan.underline(transport.url)}`);
  console.log(`   ${chalk.gray('↳')} ${chalk.white('Health:')}      ${chalk.dim(transport.url + '/health')}`);
  console.log(`   ${chalk.gray('↳')} ${chalk.white('Events:')}      ${chalk.dim(transport.url + '/events')}`);
  console.log(`   ${chalk.gray('↳')} ${chalk.white('Docs:')}        ${chalk.cyan(transport.url + '/docs')}\n`);

  logger.info('runtime: ready', {
    homeDir,
    dbPath: host.dbPath,
    pid: process.pid,
    url: transport.url,
  });

  let shuttingDown = false;
  // Keep the event loop alive — daemons have nothing scheduled by default, so
  // without this the process would exit before any signal arrives.
  const keepAlive = setInterval(() => undefined, 1 << 30);
  const exited = new Promise<number>((resolvePromise) => {
    const shutdown = async (signal: string, code: number): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('runtime: signal received', { signal });
      try {
        await transport.close();
        teamConfigWatcher.close();
        await host.shutdown({ drainMs: 10_000 });
        clearDirtyFlag(homeDir);
      } catch (err) {
        logger.error('runtime: shutdown failed', { error: err instanceof Error ? err.message : String(err) });
      } finally {
        clearInterval(keepAlive);
        resolvePromise(code);
      }
    };

    process.on('SIGINT', () => void shutdown('SIGINT', 130));
    process.on('SIGTERM', () => void shutdown('SIGTERM', 143));
    process.on('uncaughtException', (err) => {
      logger.error('runtime: uncaughtException', { error: err.message, stack: err.stack });
      void shutdown('uncaughtException', 1);
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('runtime: unhandledRejection', { reason: reason instanceof Error ? reason.message : String(reason) });
    });
  });

  const code = await exited;
  process.exit(code);
}

function safeReadPid(path: string): number | undefined {
  try {
    const n = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

void main().catch((err) => {
  console.error('runtime: fatal', err);
  process.exit(1);
});
