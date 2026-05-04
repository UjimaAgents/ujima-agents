import { openDb } from '@ujima/context-store';
import { createLocalEventBus } from '@ujima/event-bus';
import { createPermissionMiddleware } from '@ujima/permissions';
import { createMCPPool } from '@ujima/mcp-client';
import { selectLanguageModel, type ProviderKind } from '@ujima/llm';
import { selectProvider } from '@ujima/llm/legacy';
import type { AgentDef, MCPDef, TaskDef } from '@ujima/shared';
import { runAgent } from './shell';
import { resolveOrchestratorEngine, type OrchestratorEngine } from './engine';
import { createLanguageModelFromLegacyProvider } from './legacy-llm-language-model';
import type { AgentRunResult, SpawnReason } from './types';

export interface RunnerConfig {
  agent: AgentDef;
  task: TaskDef;
  sessionId: string;
  spawnReason: SpawnReason;
  dbPath: string;
  mcpDefId: string;
  /**
   * Orchestrator engine. Defaults to `'ai-sdk'` when `llm` is supplied,
   * otherwise `'legacy'` to keep the existing child-process entrypoint
   * (which reads provider env vars) working unchanged.
   */
  engine?: OrchestratorEngine;
  /**
   * AI SDK resolver inputs. Required when `engine === 'ai-sdk'`.
   * Supplied either directly here or read from env (UJIMA_LLM_*).
   */
  llm?: {
    kind: ProviderKind;
    modelId: string;
    apiKey?: string;
    baseUrl?: string;
  };
}

function readAiSdkConfigFromEnv(env: NodeJS.ProcessEnv): RunnerConfig['llm'] | undefined {
  const kind = env.UJIMA_LLM_KIND as ProviderKind | undefined;
  const modelId = env.UJIMA_LLM_MODEL_ID;
  if (!kind || !modelId) return undefined;
  return {
    kind,
    modelId,
    apiKey: env.UJIMA_LLM_API_KEY,
    baseUrl: env.UJIMA_LLM_BASE_URL,
  };
}

export async function runInRunner(config: RunnerConfig): Promise<AgentRunResult> {
  const engine = resolveOrchestratorEngine(config.engine ?? process.env.UJIMA_ORCHESTRATOR_ENGINE);
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

  let model;
  if (engine === 'legacy') {
    const provider = selectProvider({ env: process.env });
    model = createLanguageModelFromLegacyProvider(
      provider,
      config.llm?.modelId ?? process.env.UJIMA_LLM_MODEL_ID ?? 'legacy',
    );
  } else {
    const llm = config.llm ?? readAiSdkConfigFromEnv(process.env);
    if (!llm) {
      throw new Error(
        "runInRunner: requires `llm` config or UJIMA_LLM_KIND + UJIMA_LLM_MODEL_ID env vars when using `ai-sdk` engine.",
      );
    }
    model = selectLanguageModel(llm);
  }

  const handle = runAgent({
    agent: config.agent,
    task: config.task,
    sessionId: config.sessionId,
    spawnReason: config.spawnReason,
    model,
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
