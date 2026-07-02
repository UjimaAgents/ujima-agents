import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import type { AgentLoopChunk, AgentLoopStep } from '../services/agent-loop.js';

function agentLoopDir(): string {
  return join(
    process.env.UJIMA_HOME?.trim() || join(homedir(), '.ujima'),
    'agent-loop',
  );
}

// Default ON for dev; set UJIMA_AGENT_LOOP_LOGS=0 to disable.
function isEnabled(): boolean {
  return process.env.UJIMA_AGENT_LOOP_LOGS !== '0';
}

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
  /** Full context messages — the "agent context" at start of turn. */
  messages?: ModelMessage[];
  /** Reconstructed messages the model saw before this step (initial + prior step wrappers). */
  messagesAtStep?: ModelMessage[];
  tools?: Record<string, { description?: string; inputSchema?: unknown }>;
  priorSteps: AgentLoopStepLog[];
  step: AgentLoopStepLog;
  cumulativeTokens: { inputTokens: number; outputTokens: number; totalTokens: number };
  error?: string;
  runFinished?: boolean;
  timestamps: {
    startedAt: string;
    finishedAt?: string;
  };
}

function formatTimestamp(iso: string): string {
  return iso.replace(/[:-]/g, '').replace(/\.\d+/, '').replace('T', '-').slice(0, 15);
}

function truncate(str: string | undefined | null, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export interface AgentLoopStepLog {
  text?: string;
  reasoning?: string;
  toolCalls?: { toolCallId?: string; toolName?: string; input?: unknown }[];
  toolResults?: { toolCallId?: string; output?: unknown }[];
  tokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

/**
 * Reconstruct the ModelMessage[] that the model saw *before* the given step
 * index. Builds from the original messages, appending one assistant message
 * (text + tool-call parts) and one tool-role message per prior step.
 */
function reconstructMessagesAtStep(
  initialMessages: ModelMessage[] | undefined,
  priorSteps: AgentLoopStep[],
  stepIndex: number,
): ModelMessage[] {
  const out: ModelMessage[] = initialMessages ? structuredClone(initialMessages) : [];
  for (let i = 0; i < stepIndex; i++) {
    const prev = priorSteps[i];
    if (!prev) continue;
    const parts: { type: string; text?: string; toolCallId?: string; toolName?: string }[] = [];
    if (prev.text) {
      parts.push({ type: 'text', text: prev.text });
    }
    for (const tc of prev.toolCalls ?? []) {
      if (tc.toolCallId) {
        parts.push({ type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName });
      }
    }
    if (parts.length > 0) {
      out.push({ role: 'assistant', content: parts } as ModelMessage);
    }
    const trParts: { type: string; toolCallId?: string; output?: unknown }[] = [];
    for (const tr of prev.toolResults ?? []) {
      if (tr.toolCallId) {
        trParts.push({ type: 'tool-result', toolCallId: tr.toolCallId, output: tr.output });
      }
    }
    if (trParts.length > 0) {
      out.push({ role: 'tool', content: trParts } as ModelMessage);
    }
  }
  return out;
}

export class AgentLoopLogger {
  private readonly _runId: string;
  private initialMessages?: ModelMessage[];
  private allSteps: AgentLoopStep[] = [];
  private allStepLogs: AgentLoopStepLog[] = [];
  private context: {
    agentId?: string;
    threadId?: string;
    channelId?: string;
    organizationId?: string;
    modelId?: string;
    providerKind?: string;
    systemPrompt?: string;
    tools?: Record<string, { description?: string; inputSchema?: unknown }>;
  } = {};
  private currentStepReasoning = '';
  private currentStepText = '';
  private wroteAnyFile = false;
  private finalTokenUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  private finalError?: string;
  private cumulativeInputTokens = 0;
  private cumulativeOutputTokens = 0;

  constructor() {
    this._runId = randomUUID();
  }

  get runId(): string {
    return this._runId;
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
    this.context.agentId = info.agentId;
    this.context.threadId = info.threadId;
    this.context.channelId = info.channelId;
    this.context.organizationId = info.organizationId;
    const m = info.model as { modelId?: unknown; provider?: unknown } | undefined;
    this.context.modelId = typeof m?.modelId === 'string' ? m.modelId : undefined;
    this.context.providerKind = typeof m?.provider === 'string' ? m.provider : undefined;
    this.context.systemPrompt = info.systemPrompt;
    this.initialMessages = info.messages;
    if (info.tools) {
      this.context.tools = {};
      for (const [key, val] of Object.entries(info.tools)) {
        const toolDef = val as { description?: string; inputSchema?: unknown };
        this.context.tools[key] = {
          description: toolDef.description,
          inputSchema: toolDef.inputSchema,
        };
      }
    }
  }

  handleChunk(chunk: AgentLoopChunk) {
    if (!isEnabled()) return;
    if (chunk.kind === 'reasoning') {
      this.currentStepReasoning += chunk.delta;
    }
    if (chunk.kind === 'text') {
      this.currentStepText += chunk.delta;
    }
  }

  async handleStepFinish(step: AgentLoopStep) {
    if (!isEnabled()) return;

    const stepIndex = this.allSteps.length;

    const stepLog: AgentLoopStepLog = {
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
            inputTokens: step.usage.inputTokens ?? 0,
            outputTokens: step.usage.outputTokens ?? 0,
            totalTokens: step.usage.totalTokens ?? 0,
          }
        : undefined,
    };

    this.allSteps.push(step);
    this.allStepLogs.push(stepLog);

    if (stepLog.tokenUsage) {
      this.cumulativeInputTokens += stepLog.tokenUsage.inputTokens ?? 0;
      this.cumulativeOutputTokens += stepLog.tokenUsage.outputTokens ?? 0;
    }

    // --- Structured console log per step (like Timetotest) ---
    const toolCallNames = (step.toolCalls ?? []).map((tc) => tc.toolName).filter(Boolean);
    console.info(
      `[AGENT_LOOP] step=${stepIndex} tool_calls=%s text=%s reasoning=%s tokens=(i=%s o=%s) tools=[%s]`,
      step.toolCalls?.length ?? 0,
      truncate(this.currentStepText || step.text, 80),
      truncate(this.currentStepReasoning, 120),
      stepLog.tokenUsage?.inputTokens ?? '?',
      stepLog.tokenUsage?.outputTokens ?? '?',
      toolCallNames.join(', ') || 'none',
    );

    // Reconstruct what the model saw before this step
    const messagesAtStep = reconstructMessagesAtStep(this.initialMessages, this.allSteps, stepIndex);

    const entry: AgentLoopLogEntry = {
      runId: this.runId,
      turnIndex: stepIndex,
      agentId: this.context.agentId,
      threadId: this.context.threadId,
      channelId: this.context.channelId,
      modelId: this.context.modelId,
      providerKind: this.context.providerKind,
      organizationId: this.context.organizationId,
      systemPrompt: this.context.systemPrompt,
      messages: this.initialMessages,
      messagesAtStep,
      tools: this.context.tools,
      priorSteps: this.allStepLogs.slice(0, stepIndex),
      step: stepLog,
      cumulativeTokens: {
        inputTokens: this.cumulativeInputTokens,
        outputTokens: this.cumulativeOutputTokens,
        totalTokens: this.cumulativeInputTokens + this.cumulativeOutputTokens,
      },
      timestamps: {
        startedAt: this.initialTimestamp,
        finishedAt: new Date().toISOString(),
      },
    };

    await this.writeLog(entry);
    this.wroteAnyFile = true;
    this.currentStepReasoning = '';
    this.currentStepText = '';
  }

  private initialTimestamp = new Date().toISOString();

  setTokenUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
    this.finalTokenUsage = usage;
  }

  setError(error: string) {
    this.finalError = error;
  }

  async flush() {
    if (!isEnabled()) return;
    if (!this.wroteAnyFile) {
      // No steps happened — write a bare entry so there's at least some record.
      await this.writeLog({
        runId: this.runId,
        priorSteps: [],
        step: {},
        cumulativeTokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        timestamps: {
          startedAt: this.initialTimestamp,
          finishedAt: new Date().toISOString(),
        },
      });
      return;
    }
    // Write a final summary entry if we have final usage or an error not
    // already captured in the last step file.
    const lastStep = this.allStepLogs[this.allStepLogs.length - 1];
    if (!lastStep) return;
    if (this.finalTokenUsage || this.finalError) {
      const summaryEntry: AgentLoopLogEntry = {
        runId: this.runId,
        turnIndex: this.allStepLogs.length,
        agentId: this.context.agentId,
        threadId: this.context.threadId,
        channelId: this.context.channelId,
        modelId: this.context.modelId,
        providerKind: this.context.providerKind,
        organizationId: this.context.organizationId,
        systemPrompt: this.context.systemPrompt,
        messages: this.initialMessages,
        messagesAtStep: reconstructMessagesAtStep(this.initialMessages, this.allSteps, this.allSteps.length),
        tools: this.context.tools,
        priorSteps: this.allStepLogs,
        step: {},
        cumulativeTokens: {
          inputTokens: this.cumulativeInputTokens,
          outputTokens: this.cumulativeOutputTokens,
          totalTokens: this.cumulativeInputTokens + this.cumulativeOutputTokens,
        },
        error: this.finalError,
        runFinished: true,
        timestamps: {
          startedAt: this.initialTimestamp,
          finishedAt: new Date().toISOString(),
        },
      };
      await this.writeLog(summaryEntry);
    }
    console.info(
      `[AGENT_LOOP] run=%s agent=%s steps=%d totalTokens=%s`,
      this._runId.replace(/-/g, '').slice(0, 8),
      this.context.agentId ?? '?',
      this.allStepLogs.length,
      this.cumulativeInputTokens + this.cumulativeOutputTokens,
    );
  }

  private async writeLog(log: AgentLoopLogEntry) {
    const dir = agentLoopDir();
    await mkdir(dir, { recursive: true });
    const ts = formatTimestamp(log.timestamps.startedAt);
    const shortId = log.runId.replace(/-/g, '').slice(0, 8);
    const turn = log.turnIndex !== undefined
      ? `-turn-${String(log.turnIndex).padStart(3, '0')}`
      : '';
    const suffix = log.runFinished ? '-done' : '';
    const filePath = join(dir, `${ts}-${shortId}${turn}${suffix}.json`);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(log, null, 2), 'utf-8');
    await rename(tmpPath, filePath);
  }

}
