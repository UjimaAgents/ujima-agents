import type {
  AgentDef,
  MCPDef,
  TaskDef,
  TeamDef,
  UjimaEvent,
  GovernancePolicy,
} from '@ujima/shared';
import type { UjimaDb } from '@ujima/context-store';
import { openDb } from '@ujima/context-store';
import type { EventBus } from '@ujima/event-bus';
import { createLocalEventBus } from '@ujima/event-bus';
import type { PermissionMiddleware } from '@ujima/permissions';
import { createPermissionMiddleware } from '@ujima/permissions';
import type { MCPPool, MCPConnection } from '@ujima/mcp-client';
import { createMCPPool } from '@ujima/mcp-client';
import type { LLMProvider } from '@ujima/llm/legacy';
import type { GateResolver } from '@ujima/agent-runtime';
import type { RunTaskInputs, SessionHandle } from '@ujima/orchestrator';
import { runTask, ORCHESTRATOR_EVENT_CHANNEL } from '@ujima/orchestrator';
import { join } from 'node:path';
import type { Logger } from './logger';
import { noopLogger } from './logger';
import type { WorkspaceStore } from './workspaces';
import { createWorkspaceStore } from './workspaces';
import { createPathResolver } from './path-resolver';

export interface StartTaskInput {
  workspaceId: string;
  sessionId: string;
  prompt: string;
  teamId: string;
  taskId?: string;
  orchestratorMode?: 'auto' | 'manual';
  executionMode?: 'concurrent' | 'slim';
  onStream?: (event: UjimaEvent) => void;
}

export interface StartTaskResult {
  task: TaskDef;
  team: TeamDef;
  agents: AgentDef[];
  handle: SessionHandle;
}

export interface RunningTask {
  taskId: string;
  sessionId: string;
  workspaceId: string;
  teamId: string;
  startedAt: number;
  agentIds: string[];
  handle: SessionHandle;
}

export interface RunningAgent {
  agentId: string;
  taskId: string;
  sessionId: string;
  workspaceId: string;
  startedAt: number;
}

export interface EventFilter {
  channel?: string;
  eventType?: string;
  agentId?: string;
  taskId?: string;
  sessionId?: string;
  replaySinceMs?: number;
}

export interface EventSubscription {
  unsubscribe(): void;
}

export interface RuntimeHostDeps {
  /**
   * Absolute path to the runtime home dir (usually `$UJIMA_HOME`). The host
   * creates it if missing; sqlite db lives at `{homeDir}/data/ujima.db` by
   * default. Override via `config.dbPath`.
   */
  homeDir: string;
  logger?: Logger;
  loadAgent(workspaceId: string, agentId: string): Promise<AgentDef | undefined>;
  loadTeam(workspaceId: string, teamId: string): Promise<TeamDef | undefined>;
  resolveMCPDef(workspaceId: string, mcpId: string): Promise<MCPDef>;
  getProvider(agent: AgentDef): LLMProvider;
  /**
   * Returns the currently-active governance policy (hot-reload friendly) or
   * `undefined` if the workspace has none. Called on every tool check.
   */
  policyResolver?: () => GovernancePolicy | undefined;
  gateResolver?: GateResolver;
}

export interface RuntimeHostConfig {
  dbPath?: string;
}

export interface RuntimeHost {
  readonly db: UjimaDb;
  readonly bus: EventBus;
  readonly permissions: PermissionMiddleware;
  readonly pool: MCPPool;
  readonly workspaces: WorkspaceStore;
  readonly homeDir: string;
  readonly dbPath: string;
  startTask(input: StartTaskInput): Promise<StartTaskResult>;
  killTask(taskId: string): boolean;
  killAgent(taskId: string, agentId: string): boolean;
  killAllTasks(): void;
  listTasks(): RunningTask[];
  listAgents(): RunningAgent[];
  getSession(sessionId: string): { sessionId: string; tasks: RunningTask[] } | undefined;
  subscribeEvents(filter: EventFilter, handler: (event: UjimaEvent) => void): EventSubscription;
  getMCPConnection(
    workspaceId: string,
    mcpId: string,
    opts?: { agentId?: string; scopePaths?: string[] },
  ): Promise<MCPConnection>;
  shutdown(opts?: { drainMs?: number }): Promise<void>;
}

export async function createRuntimeHost(deps: RuntimeHostDeps, config: RuntimeHostConfig = {}): Promise<RuntimeHost> {
  const logger = deps.logger ?? noopLogger;
  const dbPath = config.dbPath ?? join(deps.homeDir, 'data', 'ujima.db');
  const db = openDb({ dbPath });
  const bus = createLocalEventBus({ audit: db.audit, pendingEvents: db.pendingEvents });
  const permissions = createPermissionMiddleware({
    audit: db.audit,
    agentState: db.agentState,
    governancePolicy: deps.policyResolver,
  });
  const pool = createMCPPool({});
  const workspaces = createWorkspaceStore(db.raw);
  logger.info('runtime-host: initialised', { dbPath, homeDir: deps.homeDir });

  const active = new Map<string, RunningTask>();
  let shuttingDown = false;

  async function startTask(input: StartTaskInput): Promise<StartTaskResult> {
    if (shuttingDown) throw new Error('runtime is shutting down');
    const ws = workspaces.requireReady(input.workspaceId);
    const team = await deps.loadTeam(ws.id, input.teamId);
    if (!team) throw new Error(`team "${input.teamId}" not found in workspace ${ws.id}`);

    const agents: AgentDef[] = [];
    const missing: string[] = [];
    for (const id of team.agents) {
      const a = await deps.loadAgent(ws.id, id);
      if (a) agents.push(a);
      else missing.push(id);
    }
    if (missing.length > 0) {
      throw new Error(`team "${team.team_id}" references unknown agents: ${missing.join(', ')}`);
    }

    const task: TaskDef = {
      task_id: input.taskId ?? `task_${Date.now().toString(36)}`,
      prompt: input.prompt,
      team_id: team.team_id,
      orchestrator_mode: input.orchestratorMode ?? 'manual',
      execution_mode: input.executionMode ?? 'concurrent',
    };

    const agentById = new Map(agents.map((a) => [a.id, a]));
    const inputs: RunTaskInputs = { task, team, sessionId: input.sessionId };
    const handle = runTask(
      {
        resolveAgent: (id) => agentById.get(id),
        getMCPConnection: async (mcpId, opts) => getMCPConnection(ws.id, mcpId, opts),
        getProvider: (a) => deps.getProvider(a),
        eventBus: bus,
        context: db.context,
        audit: db.audit,
        permissions,
        agentState: db.agentState,
        approvals: db.approvals,
        taskState: db.taskState,
        onStream: input.onStream,
        gateResolver: deps.gateResolver,
      },
      inputs,
    );

    const running: RunningTask = {
      taskId: task.task_id,
      sessionId: input.sessionId,
      workspaceId: ws.id,
      teamId: team.team_id,
      startedAt: Date.now(),
      agentIds: handle.agentIds(),
      handle,
    };
    active.set(task.task_id, running);
    logger.info('runtime-host: task started', {
      taskId: task.task_id,
      workspaceId: ws.id,
      teamId: team.team_id,
      agentCount: agents.length,
    });

    void handle.result.finally(() => {
      active.delete(task.task_id);
      logger.info('runtime-host: task completed', { taskId: task.task_id });
    });

    return { task, team, agents, handle };
  }

  function killTask(taskId: string): boolean {
    const t = active.get(taskId);
    if (!t) return false;
    t.handle.killSession();
    return true;
  }

  function killAgent(taskId: string, agentId: string): boolean {
    const t = active.get(taskId);
    if (!t) return false;
    if (!t.handle.agentIds().includes(agentId)) return false;
    t.handle.killAgent(agentId);
    return true;
  }

  function killAllTasks(): void {
    for (const t of active.values()) t.handle.killSession();
    active.clear();
  }

  function listTasks(): RunningTask[] {
    return [...active.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  function listAgents(): RunningAgent[] {
    const out: RunningAgent[] = [];
    for (const t of active.values()) {
      for (const agentId of t.handle.agentIds()) {
        out.push({
          agentId,
          taskId: t.taskId,
          sessionId: t.sessionId,
          workspaceId: t.workspaceId,
          startedAt: t.startedAt,
        });
      }
    }
    return out;
  }

  function getSession(sessionId: string): { sessionId: string; tasks: RunningTask[] } | undefined {
    const tasks = listTasks().filter((t) => t.sessionId === sessionId);
    if (tasks.length === 0) return undefined;
    return { sessionId, tasks };
  }

  function subscribeEvents(filter: EventFilter, handler: (event: UjimaEvent) => void): EventSubscription {
    const channel = filter.channel ?? ORCHESTRATOR_EVENT_CHANNEL;
    const unsub = bus.subscribe(
      channel,
      (event: UjimaEvent) => {
        if (filter.eventType && event.type !== filter.eventType) return;
        if (filter.agentId && event.publisher !== filter.agentId) return;
        if (filter.taskId && event.task_id !== filter.taskId) return;
        if (filter.sessionId && event.session_id !== filter.sessionId) return;
        handler(event);
      },
      filter.replaySinceMs !== undefined ? { replaySinceMs: filter.replaySinceMs } : undefined,
    );
    return { unsubscribe: unsub };
  }

  async function getMCPConnection(
    workspaceId: string,
    mcpId: string,
    opts?: { agentId?: string; scopePaths?: string[] },
  ): Promise<MCPConnection> {
    const ws = workspaces.requireReady(workspaceId);
    const workspaceRoot = ws.root_path;
    if (!workspaceRoot) {
      throw new Error(`workspace "${workspaceId}" is not ready: root_path is not set`);
    }
    const def = await deps.resolveMCPDef(workspaceId, mcpId);
    const connection = await pool.get(def, opts);
    const resolver = await createPathResolver({
      root: workspaceRoot,
      scopePaths: opts?.scopePaths,
    });
    return {
      ...connection,
      async callTool(ctx, toolName, args) {
        // MCP servers are external processes, so normalize any path-bearing
        // arguments before they cross that boundary.
        return connection.callTool(ctx, toolName, await sanitizeMcpArgs(args, resolver));
      },
    };
  }

  async function shutdown(opts?: { drainMs?: number }): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    const drainMs = opts?.drainMs ?? 10_000;
    logger.info('runtime-host: shutdown requested', { drainMs, activeTasks: active.size });

    if (active.size > 0) {
      const deadline = Date.now() + drainMs;
      const pending = [...active.values()].map((t) => t.handle.result.catch(() => undefined));
      await Promise.race([
        Promise.all(pending),
        new Promise<void>((r) => setTimeout(r, Math.max(0, deadline - Date.now()))),
      ]);
      if (active.size > 0) {
        logger.warn('runtime-host: drain window elapsed — force-killing remaining tasks', {
          remaining: active.size,
        });
        killAllTasks();
      }
    }

    try {
      db.raw.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      logger.warn('runtime-host: wal_checkpoint failed', { error: errMessage(err) });
    }

    try {
      await pool.closeAll();
    } catch (err) {
      logger.warn('runtime-host: pool.closeAll failed', { error: errMessage(err) });
    }

    try {
      await bus.close();
    } catch (err) {
      logger.warn('runtime-host: bus.close failed', { error: errMessage(err) });
    }

    try {
      await db.close();
    } catch (err) {
      logger.warn('runtime-host: db.close failed', { error: errMessage(err) });
    }

    logger.info('runtime-host: shutdown complete');
  }

  return {
    db,
    bus,
    permissions,
    pool,
    workspaces,
    homeDir: deps.homeDir,
    dbPath,
    startTask,
    killTask,
    killAgent,
    killAllTasks,
    listTasks,
    listAgents,
    getSession,
    subscribeEvents,
    getMCPConnection,
    shutdown,
  };
}

export async function sanitizeMcpArgs(
  value: unknown,
  resolver: Awaited<ReturnType<typeof createPathResolver>>,
  keyHint = '',
): Promise<unknown> {
  if (typeof value === 'string') {
    return shouldResolveMcpValue(keyHint, value) ? resolver.resolve(value) : value;
  }
  if (Array.isArray(value)) {
    const itemHint = shouldTreatArrayElementsAsPathy(keyHint) ? `${keyHint}:item` : keyHint;
    return Promise.all(value.map((item) => sanitizeMcpArgs(item, resolver, itemHint)));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries = await Promise.all(
    Object.entries(value).map(async ([key, nestedValue]) => [
      key,
      await sanitizeMcpArgs(nestedValue, resolver, key),
    ] as const),
  );
  return Object.fromEntries(entries);
}

function shouldResolveMcpValue(keyHint: string, value: string): boolean {
  if (!value || value === '-') return false;
  if (value.includes('://')) return false;

  const keyLooksPathy = /(path|file|cwd|dir|directory|root|workspace|output|input|target|dest|args?)/i.test(
    keyHint,
  );
  const valueLooksPathy =
    value === '.' ||
    value === '..' ||
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~/') ||
    value.includes('/') ||
    value.includes('\\');

  return keyLooksPathy && valueLooksPathy;
}

function shouldTreatArrayElementsAsPathy(keyHint: string): boolean {
  return /(path|file|cwd|dir|directory|root|workspace|output|input|target|dest|args?)/i.test(
    keyHint,
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
