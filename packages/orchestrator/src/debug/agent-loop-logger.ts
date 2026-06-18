import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import type { AgentLoopChunk, AgentLoopStep } from '../services/agent-loop.js';

const AGENT_LOOP_DIR = '.agent-loop';

export interface AgentLoopLogEntry {
  runId: string;
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
  private workspaceRoot?: string;

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
    if (chunk.kind === 'reasoning') {
      this.currentStepReasoning += chunk.delta;
    }
    if (chunk.kind === 'text') {
      this.currentStepText += chunk.delta;
    }
  }

  handleStepFinish(step: AgentLoopStep) {
    this.log.steps.push({
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
    });
    this.currentStepReasoning = '';
    this.currentStepText = '';
  }

  setTokenUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
    this.log.tokenUsage = usage;
  }

  setError(error: string) {
    this.log.error = error;
  }

  async flush() {
    this.log.timestamps.finishedAt = new Date().toISOString();
    const dir = join(this.workspaceRoot ?? process.cwd(), AGENT_LOOP_DIR);
    await mkdir(dir, { recursive: true });
    const ts = formatTimestamp(this.log.timestamps.startedAt);
    const shortId = this.log.runId.replace(/-/g, '').slice(0, 8);
    const filePath = join(dir, `${ts}-${shortId}.json`);
    await writeFile(filePath, JSON.stringify(this.log, null, 2), 'utf-8');
  }

  private workspaceRoot?: string;

  setWorkspaceRoot(root: string) {
    this.workspaceRoot = root;
  }
}
