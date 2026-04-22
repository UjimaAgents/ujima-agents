import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { AgentPermissions, AuditRecord } from '@ujima/shared';
import { summarizeSession, type RateSample, type SessionSummary } from '@ujima/shared';

export interface TrackedAgent {
  id: string;
  name: string;
  mcp: string;
  status: 'idle' | 'active' | 'waiting' | 'blocked' | 'killed' | 'exited';
  lastAction?: string;
  tokensUsed: number;
  tokenCap: number;
  permissions?: AgentPermissions;
}

export interface TrackedTask {
  taskId: string;
  prompt: string;
  mode: 'manual' | 'auto';
  execution: 'concurrent' | 'slim';
  status: 'running' | 'paused' | 'complete' | 'failed';
  startedAt: number;
}

const MAX_AUDIT_RECORDS = 2_000;
const MAX_RATE_SAMPLES_PER_AGENT = 240;
const SESSION_HISTORY_KEY = 'ujima.sessions.history';
const SESSION_HISTORY_MAX = 25;

export interface SessionControllerOptions {
  channel: vscode.OutputChannel;
  memento?: vscode.Memento;
}

export class SessionController {
  readonly sessionId: string;
  readonly startedAt: string;
  private readonly agents = new Map<string, TrackedAgent>();
  private readonly tasks = new Map<string, TrackedTask>();
  private readonly audit: AuditRecord[] = [];
  private readonly rateSamples = new Map<string, RateSample[]>();
  private history: SessionSummary[] = [];
  private readonly memento: vscode.Memento | undefined;
  private readonly channel: vscode.OutputChannel;

  private readonly didChangeAgentsEmitter = new vscode.EventEmitter<void>();
  private readonly didChangeTasksEmitter = new vscode.EventEmitter<void>();
  private readonly didAppendAuditEmitter = new vscode.EventEmitter<AuditRecord[]>();
  private readonly didUpdateRateEmitter = new vscode.EventEmitter<{ agentId: string; samples: RateSample[] }>();
  private readonly didChangeSessionsEmitter = new vscode.EventEmitter<void>();

  readonly onDidChangeAgents = this.didChangeAgentsEmitter.event;
  readonly onDidChangeTasks = this.didChangeTasksEmitter.event;
  readonly onDidAppendAudit = this.didAppendAuditEmitter.event;
  readonly onDidUpdateRate = this.didUpdateRateEmitter.event;
  readonly onDidChangeSessions = this.didChangeSessionsEmitter.event;

  constructor(options: SessionControllerOptions | vscode.OutputChannel) {
    if ('appendLine' in options) {
      this.channel = options;
      this.memento = undefined;
    } else {
      this.channel = options.channel;
      this.memento = options.memento;
    }
    this.sessionId = `sess_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    this.startedAt = new Date().toISOString();
    this.history = this.memento?.get<SessionSummary[]>(SESSION_HISTORY_KEY, []) ?? [];
    this.recordAudit({
      agent_id: 'session',
      task_id: '-',
      event_type: 'spawn',
      allowed: true,
    });
  }

  listAgents(): TrackedAgent[] {
    return [...this.agents.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  listTasks(): TrackedTask[] {
    return [...this.tasks.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  listAudit(): AuditRecord[] {
    return this.audit.slice();
  }

  listRate(): { agentId: string; samples: RateSample[] }[] {
    return [...this.rateSamples.entries()].map(([agentId, samples]) => ({ agentId, samples: samples.slice() }));
  }

  listSessions(): SessionSummary[] {
    return [this.currentSessionSummary(), ...this.history];
  }

  upsertAgent(agent: TrackedAgent): void {
    this.agents.set(agent.id, agent);
    this.didChangeAgentsEmitter.fire();
  }

  removeAgent(id: string): void {
    this.agents.delete(id);
    this.didChangeAgentsEmitter.fire();
  }

  registerTask(task: TrackedTask): void {
    this.tasks.set(task.taskId, task);
    this.channel.appendLine(`[task] ${task.taskId} started — ${task.prompt}`);
    this.didChangeTasksEmitter.fire();
  }

  killAgent(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    this.agents.set(id, { ...agent, status: 'killed', lastAction: 'killed by user' });
    this.channel.appendLine(`[kill] agent ${id}`);
    this.recordAudit({ agent_id: id, task_id: '-', event_type: 'kill', allowed: true });
    this.didChangeAgentsEmitter.fire();
    return true;
  }

  killSession(): void {
    for (const [id, agent] of this.agents) {
      this.agents.set(id, { ...agent, status: 'killed', lastAction: 'session killed' });
    }
    for (const [id, task] of this.tasks) {
      this.tasks.set(id, { ...task, status: 'paused' });
    }
    this.channel.appendLine(`[kill] session-wide`);
    this.recordAudit({
      agent_id: 'session',
      task_id: '-',
      event_type: 'kill',
      allowed: true,
      block_reason: 'session kill',
    });
    void this.persistCurrentSession('killed');
    this.didChangeAgentsEmitter.fire();
    this.didChangeTasksEmitter.fire();
    this.didChangeSessionsEmitter.fire();
  }

  updateAgentPermissions(id: string, permissions: AgentPermissions): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    this.agents.set(id, { ...agent, permissions });
    this.channel.appendLine(`[permissions] ${id} updated (session scope)`);
    this.recordAudit({
      agent_id: id,
      task_id: '-',
      event_type: 'permission_check',
      allowed: true,
      tool_input: { permissions },
    });
    this.didChangeAgentsEmitter.fire();
    return true;
  }

  recordAudit(partial: Partial<AuditRecord> & Pick<AuditRecord, 'agent_id' | 'task_id' | 'event_type' | 'allowed'>): AuditRecord {
    const record: AuditRecord = {
      event_id: partial.event_id ?? `aud_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      event_type: partial.event_type,
      agent_id: partial.agent_id,
      task_id: partial.task_id,
      session_id: this.sessionId,
      tool_name: partial.tool_name,
      tool_input: partial.tool_input,
      tool_output: partial.tool_output,
      allowed: partial.allowed,
      block_reason: partial.block_reason,
      tokens_used: partial.tokens_used,
      duration_ms: partial.duration_ms,
      created_at: partial.created_at ?? new Date().toISOString(),
    };
    this.audit.push(record);
    if (this.audit.length > MAX_AUDIT_RECORDS) this.audit.splice(0, this.audit.length - MAX_AUDIT_RECORDS);
    this.didAppendAuditEmitter.fire([record]);
    return record;
  }

  recordRateSample(agentId: string, sample: Omit<RateSample, 'at'> & { at?: string }): void {
    const samples = this.rateSamples.get(agentId) ?? [];
    samples.push({ at: sample.at ?? new Date().toISOString(), calls: sample.calls, tokens: sample.tokens });
    if (samples.length > MAX_RATE_SAMPLES_PER_AGENT) {
      samples.splice(0, samples.length - MAX_RATE_SAMPLES_PER_AGENT);
    }
    this.rateSamples.set(agentId, samples);
    this.didUpdateRateEmitter.fire({ agentId, samples: samples.slice() });
  }

  currentSessionSummary(): SessionSummary {
    return summarizeSession({
      session_id: this.sessionId,
      startedAt: this.startedAt,
      status: 'running',
      agent_ids: [...this.agents.keys()],
      task_ids: [...this.tasks.keys()],
      audit: this.audit,
    });
  }

  async persistCurrentSession(status: 'ended' | 'killed'): Promise<void> {
    if (!this.memento) return;
    const summary: SessionSummary = {
      ...this.currentSessionSummary(),
      status,
      endedAt: new Date().toISOString(),
    };
    const next = [summary, ...this.history.filter((s) => s.session_id !== summary.session_id)].slice(
      0,
      SESSION_HISTORY_MAX,
    );
    this.history = next;
    await this.memento.update(SESSION_HISTORY_KEY, next);
    this.didChangeSessionsEmitter.fire();
  }

  findSession(sessionId: string): SessionSummary | undefined {
    return this.listSessions().find((s) => s.session_id === sessionId);
  }

  dispose(): void {
    void this.persistCurrentSession('ended');
    this.didChangeAgentsEmitter.dispose();
    this.didChangeTasksEmitter.dispose();
    this.didAppendAuditEmitter.dispose();
    this.didUpdateRateEmitter.dispose();
    this.didChangeSessionsEmitter.dispose();
  }
}
