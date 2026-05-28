import { openDb } from '@ujima/context-store';
import { createLocalEventBus } from '@ujima/event-bus';
import { createPermissionMiddleware, type ClassificationLookup } from '@ujima/permissions';
import { createMCPPool } from '@ujima/mcp-client';
import { selectLanguageModel, type ProviderKind } from '@ujima/llm';
import type { AgentDef, GovernancePolicy, MCPDef, TaskDef } from '@ujima/shared';
import { runAgent } from './shell';
import { resolveOrchestratorEngine, type OrchestratorEngine } from './engine';
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
  classificationLookup?: ClassificationLookup;
  // Snapshot of the governance policy the runner should enforce.
  // Must be serialisable — the runner is reached via UJIMA_RUNNER_CONFIG
  // (JSON-encoded child-process env var), so callbacks aren't an option.
  // Spawning callers load the policy from their repo and embed it here.
  // When omitted, the middleware behaves as before: no `risk_defaults`
  // / agent rules apply and legacy allow/block lists govern.
  governancePolicy?: GovernancePolicy;
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
  // Validate engine value (always ai-sdk); the assignment isn't used
  // but validateOrchestratorEngine throws on invalid input.
  void resolveOrchestratorEngine(config.engine ?? process.env.UJIMA_ORCHESTRATOR_ENGINE);
  const db = openDb({ dbPath: config.dbPath });
  const bus = createLocalEventBus({ audit: db.audit, pendingEvents: db.pendingEvents });
  const permissions = createPermissionMiddleware({
    audit: db.audit,
    agentState: db.agentState,
    governancePolicy: config.governancePolicy,
    classificationLookup: config.classificationLookup,
  });
  const pool = createMCPPool();
  const mcpConfig = await db.context.get<{ defs: Record<string, unknown> }>('system:mcp-config');
  const mcpDef = (mcpConfig?.defs as Record<string, unknown> | undefined)?.[config.mcpDefId] as
    | MCPDef
    | undefined;
  if (!mcpDef) {
    throw new Error(`MCP definition "${config.mcpDefId}" not found in context store`);
  }
  const mcp = await pool.get(mcpDef);

  const llm = config.llm ?? readAiSdkConfigFromEnv(process.env);
  if (!llm) {
    throw new Error(
      "runInRunner: requires `llm` config or UJIMA_LLM_KIND + UJIMA_LLM_MODEL_ID env vars.",
    );
  }
  const model = selectLanguageModel(llm);

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
