import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LanguageModel } from 'ai';
import type { AiSdkLoopOutcome } from './ai-sdk-loop';

const AGENT_LOOP_DIR = '.agent-loop';

function formatTimestamp(iso: string): string {
  return iso.replace(/[:-]/g, '').replace(/\.\d+/, '').replace('T', '-').slice(0, 15);
}

export interface AgentRunLogEntry {
  runId: string;
  kind: 'spawned';
  agentId?: string;
  taskId?: string;
  sessionId?: string;
  modelId?: string;
  mcpName?: string;
  systemPrompt?: string;
  userPrompt?: string;
  tools?: { name: string; description?: string }[];
  outcome?: {
    exitReason: string;
    iterations: number;
    toolCalls: number;
    tokensUsed: number;
    finalText: string;
    escalationReason?: string;
    error?: string;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  };
  error?: string;
  timestamps: {
    startedAt: string;
    finishedAt?: string;
  };
}

export class AgentRunLogger {
  private log: AgentRunLogEntry;

  constructor() {
    this.log = {
      runId: randomUUID(),
      kind: 'spawned',
      timestamps: {
        startedAt: new Date().toISOString(),
      },
    };
  }

  setContext(info: {
    agentId?: string;
    taskId?: string;
    sessionId?: string;
    model?: LanguageModel;
    systemPrompt?: string;
    userPrompt?: string;
    tools?: { name: string; description?: string }[];
    mcpName?: string;
  }) {
    this.log.agentId = info.agentId;
    this.log.taskId = info.taskId;
    this.log.sessionId = info.sessionId;
    this.log.systemPrompt = info.systemPrompt;
    this.log.userPrompt = info.userPrompt;
    this.log.tools = info.tools;
    this.log.mcpName = info.mcpName;
    const m = info.model as { modelId?: unknown } | undefined;
    this.log.modelId = typeof m?.modelId === 'string' ? m.modelId : undefined;
  }

  setOutcome(outcome: AiSdkLoopOutcome) {
    this.log.outcome = {
      exitReason: outcome.exitReason,
      iterations: outcome.iterations,
      toolCalls: outcome.toolCalls,
      tokensUsed: outcome.tokensUsed,
      finalText: outcome.finalText,
      escalationReason: outcome.escalationReason,
      error: outcome.error,
      usage: outcome.usage,
    };
  }

  setError(error: string) {
    this.log.error = error;
  }

  async flush() {
    this.log.timestamps.finishedAt = new Date().toISOString();
    const dir = join(process.cwd(), AGENT_LOOP_DIR);
    await mkdir(dir, { recursive: true });
    const ts = formatTimestamp(this.log.timestamps.startedAt);
    const shortId = this.log.runId.replace(/-/g, '').slice(0, 8);
    const filePath = join(dir, `${ts}-${shortId}.json`);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(this.log, null, 2), 'utf-8');
    await rename(tmpPath, filePath);
  }
}
