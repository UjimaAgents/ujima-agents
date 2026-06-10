#!/usr/bin/env node
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import {
  createFileSecretStore,
  createJsonLogger,
  createRuntimeHost,
  Repository,
} from '@ujima/runtime-core';
import type { AgentDef, MCPDef, TeamDef } from '@ujima/shared';
import type { LanguageModel } from 'ai';
import {
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  ConfigSyncService,
  createApiServices,
  createTeamStore,
  migrateUnifiedWorkspaceOrg,
  type PermissionContextBuilder,
} from '@ujima/orchestrator';
import { createTransport } from './transport/server.js';
import { ensureBearerToken } from './transport/token.js';
import { DEFAULT_BIND_HOST, DEFAULT_BIND_PORT } from '@ujima/api-schema';
import { startTeamConfigWatcher } from './config-sync.js';
import {
  buildPolicyResolver,
  buildClassificationLookup,
  type DaemonRepoRef,
} from './governance-resolvers.js';

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

function mcpPermissionToolName(serverId: string, toolName: string): string {
  return `mcp:${encodeURIComponent(serverId)}:${encodeURIComponent(toolName)}`;
}

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
  const homeDir = resolveHomeDir();
  mkdirSync(homeDir, { recursive: true });
  const logger = createJsonLogger({
    write: (line: string) => {
      if (process.env.NODE_ENV === 'production') {
        process.stderr.write(line + '\n');
      } else {
        const { ts, level: lvl, message, component, ...rest } = JSON.parse(line) as {
          ts: string;
          level: string;
          message: string;
          component?: string;
          [key: string]: unknown;
        };
        const time = chalk.dim(new Date(ts).toLocaleTimeString());
        const level = lvl === 'error' ? chalk.red(lvl) : lvl === 'warn' ? chalk.yellow(lvl) : chalk.blue(lvl);
        const comp = chalk.magenta(`[${component || 'sys'}]`);
        const tail = Object.keys(rest).length > 0 ? ' ' + chalk.gray(JSON.stringify(rest)) : '';
        process.stderr.write(`${time} ${level} ${comp} ${chalk.white(message)}${tail}\n`);
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

  // Late ref so the policy/classification resolvers can reach the
  // Repository wrapper that's constructed after the host. Without this
  // wire-up, the runtime-host's permission middleware would never see
  // the governance policy or per-tool classifications — risk_defaults
  // / classification gating would be silently skipped on the headless
  // runtime path even though tool-service-impl already enforces them
  // on the orchestrator path. The closures resolve the active org via
  // `getLatestOrganization()` since the daemon is single-org per
  // process (matches the migrateUnifiedWorkspaceOrg assumption).
  const lateRepoRef: DaemonRepoRef = { current: undefined };

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
      getModel: (agent: AgentDef): LanguageModel => {
        throw new Error(`runtime: no model configured for agent "${agent.id}"`);
      },
      policyResolver: buildPolicyResolver(lateRepoRef),
      classificationLookup: buildClassificationLookup(lateRepoRef),
    },
    {},
  );

  const token = ensureBearerToken(homeDir);
  const bindHost = process.env.UJIMA_BIND_HOST ?? DEFAULT_BIND_HOST;


  const secretStore = createFileSecretStore({ homeDir });
  const repository = new Repository(host.db.raw, secretStore);
  lateRepoRef.current = repository;
  closeOrphanedActiveRuns(repository);
  const teamStore = createTeamStore();
  const migration = migrateUnifiedWorkspaceOrg({
    repo: repository,
    teamStore,
    workspaces: host.workspaces,
    logger,
  });
  if (migration.splits.length > 0) {
    logger.info('runtime: unified workspace/org migration', { splits: migration.splits });
  }
  const configSync = new ConfigSyncService(repository, teamStore);
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
    let team = teamStore.getTeam(input.organizationId);
    if (!team) {
      configSync.loadFromStoredConfig(input.organizationId);
      team = teamStore.getTeam(input.organizationId);
    }
    const member = repository.getMember(input.organizationId, input.memberId);
    const role = team && member ? team.getRole(member.roleName) : undefined;
    const agentConfig = team
      ? (team.getAgent(input.memberId) ??
        (member ? team.getAgent(member.name) : undefined))
      : undefined;
    let permissionToolName = input.permissionToolName ?? input.toolId;
    if (input.toolId === 'mcp') {
      const inputRecord = input.input ?? {};
      const serverId =
        input.permissionMcpId ??
        (typeof inputRecord.mcpServerId === 'string' ? inputRecord.mcpServerId : input.toolId);
      const rawToolName =
        typeof inputRecord.toolName === 'string'
          ? inputRecord.toolName
          : (input.permissionToolName ?? input.toolId);
      permissionToolName =
        typeof inputRecord.toolName !== 'string' && rawToolName.startsWith('mcp:')
          ? rawToolName
          : mcpPermissionToolName(serverId, rawToolName);
    }
    const allowedTools = new Set([
      ...(role?.tools ?? []),
      ...ALWAYS_AVAILABLE_AGENT_TOOLS,
    ]);
    if (input.toolId === 'mcp') {
      allowedTools.add(permissionToolName);
    }

    return {
      agent: {
        id: input.memberId,
        name: agentConfig?.name ?? input.memberId,
        persona: agentConfig?.personalityName ?? '',
        model: member?.model ?? role?.model ?? '',
        mcp: input.permissionMcpId ?? input.toolId,
        permissions: {
          allowed_tools: [...allowedTools],
          blocked_tools: [],
          rate_limit: { max_session_tokens: 100_000 },
        },
        communication: { publishes: [], subscribes: [] },
        escalation: { conditions: [], escalate_to: 'human' },
      },
      mcp: { id: input.permissionMcpId ?? input.toolId },
      toolName: permissionToolName,
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
          archiveRoot: homeDir,
          teamStore,
          repo: repository,
          workspaces: host.workspaces,
          realtime,
          permissions: host.permissions,
          buildPermissionContext,
          mcpPool: host.pool,
        }),
    },
  });
  await transport.listen();
  transport.startBackgroundServices();

  console.info(chalk.cyan(STARTUP_SPLASH));
  console.info(`   ${chalk.green('✓')} ${chalk.bold('System Ready')}`);
  const displayUrl = transport.url.replace('127.0.0.1', 'localhost');
  console.info(`   ${chalk.gray('↳')} ${chalk.white('API:')}         ${chalk.cyan.underline(displayUrl)}`);
  console.info(`   ${chalk.gray('↳')} ${chalk.white('Health:')}      ${chalk.dim(displayUrl + '/health')}`);
  console.info(`   ${chalk.gray('↳')} ${chalk.white('Events:')}      ${chalk.dim(displayUrl + '/events')}`);
  console.info(`   ${chalk.gray('↳')} ${chalk.white('Docs:')}        ${chalk.cyan(displayUrl + '/docs')}\n`);

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
      logger.error('runtime: unhandledRejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    });
  });

  const code = await exited;
  process.exit(code);
}

function closeOrphanedActiveRuns(repository: Repository): void {
  const endedAt = new Date().toISOString();
  for (const organization of repository.listOrganizations()) {
    const snapshot = repository.getBootstrapSnapshot(organization.id);
    for (const run of snapshot.activeRuns) {
      repository.saveRun({
        ...run,
        status: 'failed',
        step: 'failed',
        summary: 'Runtime restarted before this run completed.',
        endedAt,
      });
    }

    for (const approval of repository.listPendingApprovals(organization.id)) {
      const run = approval.runId ? repository.getRun(organization.id, approval.runId) : null;
      if (!run || isTerminalRunStatus(run.status)) {
        repository.deleteApproval(organization.id, approval.id);
      }
    }
  }
}

function isTerminalRunStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
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
