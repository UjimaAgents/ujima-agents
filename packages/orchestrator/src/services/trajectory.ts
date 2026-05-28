import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RunState } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

/**
 * Bet 5 — trajectory JSONL log.
 *
 * On every completed run, append one JSONL line per run to
 * `<workspace-root>/ai/memory-bank/trajectories/<member-or-org>.jsonl`.
 * The format is intentionally ShareGPT-style (`{conversations,
 * timestamp, model, completed}`) so it opens in any inspection tool
 * and slots into future evals / training data without a custom
 * parser. Gated by env var `UJIMA_TRAJECTORY_LOG=1` so production
 * deployments opt in.
 *
 * Inspired by Hermes Agent `agent/trajectory.py` (~50 LOC): a single
 * append-only file per agent, lazy directory creation, fire-and-forget
 * on the run-completion hook. We add nothing — the `audit_events`,
 * `runs`, `run_steps`, and `messages` tables already have everything
 * we need; trajectory.ts is a pure projection.
 */

export interface TrajectoryEntry {
  runId: string;
  organizationId: string;
  memberId: string;
  threadId?: string;
  model?: string;
  status: string;
  terminatingTool?: string | null;
  wakeReason?: string | null;
  startedAt: string;
  endedAt?: string;
  conversations: { role: string; content: string }[];
  toolCalls: { toolId: string; action: string; resourcePath?: string; status: string }[];
  /**
   * Procedures-as-Culture (docs/procedures-as-culture.md "Provenance +
   * observability"). The (scope, name, version) tuples that the wake-
   * time aggregator surfaced into the system prompt for this run. The
   * run-detail UI renders this list so an admin can answer "why did
   * Layla do X" by reading the procedures-applied trail.
   */
  proceduresApplied?: {
    scope: string;
    scopeId: string;
    name: string;
    version: number;
    enforced: boolean;
  }[];
}

export interface TrajectoryServiceOptions {
  /** Override the trajectory dir (defaults to `<workspaceRoot>/ai/memory-bank/trajectories`). */
  trajectoryDir?: string;
  /** Force-on the writer regardless of env var. */
  forceEnabled?: boolean;
  /** Cap per-conversation messages (older messages drop). Default 50. */
  maxMessages?: number;
}

export class TrajectoryService {
  private readonly enabled: boolean;
  private readonly customDir?: string;
  private readonly maxMessages: number;

  constructor(options: TrajectoryServiceOptions = {}) {
    this.enabled = options.forceEnabled ?? process.env.UJIMA_TRAJECTORY_LOG === '1';
    this.customDir = options.trajectoryDir;
    this.maxMessages = options.maxMessages ?? 50;
  }

  /**
   * Called from `SpiritService.completeRun`. Best-effort — never
   * blocks the run-completion path.
   */
  async record(input: { run: RunState; repo: ApiRepository; workspaceRoot: string }): Promise<void> {
    if (!this.enabled) return;
    try {
      const entry = await this.buildEntry(input);
      if (!entry) return;
      const dir = this.customDir ?? join(input.workspaceRoot, 'ai', 'memory-bank', 'trajectories');
      const safeMember = input.run.agentId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64) || 'unknown';
      const path = join(dir, `${safeMember}.jsonl`);
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // best-effort — trajectory logging never poisons run completion
    }
  }

  private async buildEntry(input: {
    run: RunState;
    repo: ApiRepository;
  }): Promise<TrajectoryEntry | null> {
    const { run, repo } = input;
    const messages = run.threadId
      ? repo.listMessages(run.organizationId, run.threadId, undefined, this.maxMessages).data
      : [];
    const conversations = messages.slice(-this.maxMessages).map((m) => ({
      role: m.senderKind === 'human' ? 'user' : m.senderId === run.agentId ? 'assistant' : 'agent',
      content: m.content,
    }));
    const steps = repo.listRunSteps?.(run.organizationId, run.id) ?? [];
    const toolCalls = steps.map((s) => ({
      toolId: s.toolId,
      action: s.action,
      resourcePath: s.resourcePath || undefined,
      status: s.status,
    }));
    const proceduresApplied = repo.listRunProceduresApplied?.(run.organizationId, run.id) ?? [];
    return {
      runId: run.id,
      organizationId: run.organizationId,
      memberId: run.agentId,
      threadId: run.threadId,
      status: run.status,
      terminatingTool: run.terminatingTool ?? null,
      wakeReason: run.wakeReason ?? null,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      conversations,
      toolCalls,
      proceduresApplied: proceduresApplied.length > 0
        ? proceduresApplied.map((p) => ({
            scope: p.scope,
            scopeId: p.scopeId,
            name: p.name,
            version: p.version,
            enforced: p.enforced,
          }))
        : undefined,
    };
  }
}
