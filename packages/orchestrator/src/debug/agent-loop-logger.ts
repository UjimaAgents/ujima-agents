import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import type { AgentLoopChunk, AgentLoopStep } from '../services/agent-loop.js';

const AGENT_LOOP_DIR = '.agent-loop';

export interface AgentLoopLogEntry {
  runId: string;
  turnIndex?: number;
  agentId?: string;
  threadId?: string;
  channelId?: string;
  modelId?: string;
  providerKind?: string;
  organizationId?: string;
  systemPrompt?: string;
  messages?: ModelMessage[];
  tools?: Record<string, { description?: string; inputSchema?: unknown }>;
  steps: AgentLoopStepLog[];
  tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  error?: string;
  timestamps: {
    startedAt: string;
    finishedAt?: string;
  };
}

function formatTimestamp(iso: string): string {
  return iso.replace(/[:-]/g, '').replace(/\.\d+/, '').replace('T', '-').slice(0, 15);
}

interface AgentLoopStepLog {
  text?: string;
  reasoning?: string;
  toolCalls?: { toolCallId?: string; toolName?: string; input?: unknown }[];
  toolResults?: { toolCallId?: string; output?: unknown }[];
  tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export class AgentLoopLogger {
  private log: AgentLoopLogEntry;
  private currentStepReasoning = '';
  private currentStepText = '';
  private turnIndex = 0;
  private wroteTurnFile = false;
  private workspaceRoot?: string;
  private readonly enabled = process.env.UJIMA_AGENT_LOOP_LOGS === '1';

  constructor() {
    this.log = {
      runId: randomUUID(),
      steps: [],
      timestamps: {
        startedAt: new Date().toISOString(),
      },
    };
  }

  get runId(): string {
    return this.log.runId;
  }

  setContext(info: {
    agentId?: string;
    threadId?: string;
    channelId?: string;
    organizationId?: string;
    model?: LanguageModel;
    systemPrompt?: string;
    messages?: ModelMessage[];
    tools?: ToolSet;
  }) {
    if (!this.enabled) return;
    this.log.agentId = info.agentId;
    this.log.threadId = info.threadId;
    this.log.channelId = info.channelId;
    this.log.organizationId = info.organizationId;
    const m = info.model as { modelId?: unknown; provider?: unknown } | undefined;
    this.log.modelId = typeof m?.modelId === 'string' ? m.modelId : undefined;
    this.log.providerKind = typeof m?.provider === 'string' ? m.provider : undefined;
    this.log.systemPrompt = info.systemPrompt;
    this.log.messages = info.messages;
    if (info.tools) {
      this.log.tools = {};
      for (const [key, val] of Object.entries(info.tools)) {
        const toolDef = val as { description?: string; inputSchema?: unknown };
        this.log.tools[key] = {
          description: toolDef.description,
          inputSchema: toolDef.inputSchema,
        };
      }
    }
  }

  handleChunk(chunk: AgentLoopChunk) {
    if (!this.enabled) return;
    if (chunk.kind === 'reasoning') {
      this.currentStepReasoning += chunk.delta;
    }
    if (chunk.kind === 'text') {
      this.currentStepText += chunk.delta;
    }
  }

  async handleStepFinish(step: AgentLoopStep) {
    if (!this.enabled) return;
    const stepLog = {
      text: this.currentStepText || step.text,
      reasoning: this.currentStepReasoning || undefined,
      toolCalls: step.toolCalls?.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      })),
      toolResults: step.toolResults?.map((tr) => ({
        toolCallId: tr.toolCallId,
        output: tr.output,
      })),
      tokenUsage: step.usage
        ? {
            inputTokens: step.usage.inputTokens,
            outputTokens: step.usage.outputTokens,
            totalTokens: step.usage.totalTokens,
          }
        : undefined,
    };
    this.log.steps.push(stepLog);
    this.currentStepReasoning = '';
    this.currentStepText = '';
    await this.writeLog({
      ...this.log,
      turnIndex: ++this.turnIndex,
      steps: [stepLog],
      tokenUsage: stepLog.tokenUsage,
      timestamps: { ...this.log.timestamps, finishedAt: new Date().toISOString() },
    });
    this.wroteTurnFile = true;
  }

  setTokenUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
    if (!this.enabled) return;
    this.log.tokenUsage = usage;
  }

  setError(error: string) {
    if (!this.enabled) return;
    this.log.error = error;
  }

  async flush() {
    if (!this.enabled) return;
    if (this.wroteTurnFile) return;
    this.log.timestamps.finishedAt = new Date().toISOString();
    await this.writeLog(this.log);
  }

  private async writeLog(log: AgentLoopLogEntry) {
    const dir = join(this.workspaceRoot ?? process.cwd(), AGENT_LOOP_DIR);
    await mkdir(dir, { recursive: true });
    const ts = formatTimestamp(log.timestamps.startedAt);
    const shortId = log.runId.replace(/-/g, '').slice(0, 8);
    const turn = log.turnIndex ? `-turn-${String(log.turnIndex).padStart(3, '0')}` : '';
    const filePath = join(dir, `${ts}-${shortId}${turn}.json`);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(log, null, 2), 'utf-8');
    await rename(tmpPath, filePath);
  }

  setWorkspaceRoot(root: string) {
    if (!this.enabled) return;
    this.workspaceRoot = root;
  }
}
