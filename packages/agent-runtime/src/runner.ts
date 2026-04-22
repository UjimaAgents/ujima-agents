import { openDb } from '@ujima/context-store';
import { createLocalEventBus } from '@ujima/event-bus';
import { createPermissionMiddleware } from '@ujima/permissions';
import { createMCPPool } from '@ujima/mcp-client';
import { selectProvider } from '@ujima/llm';
import type { AgentDef, MCPDef, TaskDef } from '@ujima/shared';
import { runAgent } from './shell';
import type { AgentRunResult, SpawnReason } from './types';

export interface RunnerConfig {
  agent: AgentDef;
  task: TaskDef;
  sessionId: string;
  spawnReason: SpawnReason;
  dbPath: string;
  mcpDefId: string;
}

export async function runInRunner(config: RunnerConfig): Promise<AgentRunResult> {
  const db = openDb({ dbPath: config.dbPath });
  const bus = createLocalEventBus({ audit: db.audit, pendingEvents: db.pendingEvents });
  const permissions = createPermissionMiddleware({ audit: db.audit, agentState: db.agentState });
  const pool = createMCPPool();
  const mcpConfig = await db.context.get<{ defs: Record<string, unknown> }>('system:mcp-config');
  const mcpDef = (mcpConfig?.defs as Record<string, unknown> | undefined)?.[config.mcpDefId] as
    | MCPDef
    | undefined;
  if (!mcpDef) {
    throw new Error(`MCP definition "${config.mcpDefId}" not found in context store`);
  }
  const mcp = await pool.get(mcpDef);
  const provider = selectProvider();

  const handle = runAgent({
    agent: config.agent,
    task: config.task,
    sessionId: config.sessionId,
    spawnReason: config.spawnReason,
    provider,
    mcp,
    permissions,
    eventBus: bus,
    context: db.context,
    audit: db.audit,
    agentState: db.agentState,
    approvals: db.approvals,
  });

  process.on('SIGTERM', () => handle.kill());
  process.on('SIGINT', () => handle.kill());

  const result = await handle.result;
  await pool.closeAll();
  await bus.close();
  await db.close();
  return result;
}

async function main(): Promise<void> {
  const raw = process.env.UJIMA_RUNNER_CONFIG;
  if (!raw) {
    throw new Error('UJIMA_RUNNER_CONFIG env var is required');
  }
  const config = JSON.parse(raw) as RunnerConfig;
  const result = await runInRunner(config);
  process.stdout.write(`${JSON.stringify({ ujimaResult: result })}\n`);
  process.exit(result.exitReason === 'completed' || result.exitReason === 'escalated' ? 0 : 1);
}

if (process.env.UJIMA_RUNNER_AUTOSTART === '1') {
  main().catch((err: unknown) => {
    process.stderr.write(`runner error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
