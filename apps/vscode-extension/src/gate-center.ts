import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { PendingGate } from '@ujima/shared';
import type {
  GateDecision,
  GateRequest,
  GateResolver,
} from '@ujima/agent-runtime';

type GateOutcome = 'approve' | 'reject' | 'expired' | 'aborted';

export interface GateResolvedPayload {
  id: string;
  gate: PendingGate;
  outcome: GateOutcome;
  reason?: string;
  decidedBy?: string;
}

export interface GateDecidePayload {
  id: string;
  outcome: 'approve' | 'reject';
  args?: Record<string, unknown>;
  reason?: string;
  decidedBy?: string;
}

interface PendingEntry {
  gate: PendingGate;
  resolve: (decision: GateDecision) => void;
  abortHandler?: () => void;
  abortSignal?: AbortSignal;
}

/**
 * Holds in-flight policy-gate requests (require_approval / require_input)
 * and exposes a GateResolver the agent runtime awaits while pending.
 *
 * Decisions come from the governance panel webview via `decide(...)`.
 */
export class GateCenter implements vscode.Disposable {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly addedEmitter = new vscode.EventEmitter<PendingGate>();
  private readonly resolvedEmitter = new vscode.EventEmitter<GateResolvedPayload>();

  readonly onGateAdded = this.addedEmitter.event;
  readonly onGateResolved = this.resolvedEmitter.event;

  constructor(private readonly channel?: vscode.OutputChannel) {}

  resolver(): GateResolver {
    return {
      awaitDecision: (req) => this.enqueue(req),
    };
  }

  list(): PendingGate[] {
    return [...this.pending.values()]
      .map((e) => e.gate)
      .sort((a, b) => (a.requested_at < b.requested_at ? -1 : 1));
  }

  decide(input: GateDecidePayload): boolean {
    const entry = this.pending.get(input.id);
    if (!entry) return false;
    this.finalize(entry, input.outcome, {
      args: input.outcome === 'approve' ? input.args : undefined,
      reason: input.reason,
      decidedBy: input.decidedBy ?? 'human',
    });
    return true;
  }

  /**
   * Reject every pending gate — used when the session/task is killed or the
   * governance panel is closed and we don't want runtime agents stuck forever.
   */
  abortAll(reason: string): void {
    for (const id of [...this.pending.keys()]) {
      const entry = this.pending.get(id);
      if (!entry) continue;
      this.finalize(entry, 'aborted', { reason });
    }
  }

  dispose(): void {
    this.abortAll('gate-center disposed');
    this.addedEmitter.dispose();
    this.resolvedEmitter.dispose();
  }

  private enqueue(req: GateRequest): Promise<GateDecision> {
    const id = `gate_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const gate: PendingGate = {
      id,
      agent_id: req.agentId,
      task_id: req.taskId,
      session_id: req.sessionId,
      tool_call_id: req.toolCallId,
      tool_name: req.toolName,
      mcp_id: req.mcpId,
      mcp_name: req.mcpName,
      args: req.args,
      gate: req.gate,
      code: req.code,
      reason: req.reason,
      requested_at: new Date().toISOString(),
    };
    this.channel?.appendLine(
      `[gate] enqueued ${id} agent=${gate.agent_id} tool=${gate.tool_name} gate=${gate.gate}`,
    );

    return new Promise<GateDecision>((resolve) => {
      const entry: PendingEntry = { gate, resolve, abortSignal: req.abortSignal };
      if (req.abortSignal) {
        if (req.abortSignal.aborted) {
          setImmediate(() => this.finalize(entry, 'aborted'));
        } else {
          entry.abortHandler = () => this.finalize(entry, 'aborted');
          req.abortSignal.addEventListener('abort', entry.abortHandler, { once: true });
        }
      }
      this.pending.set(id, entry);
      this.addedEmitter.fire(gate);
    });
  }

  private finalize(
    entry: PendingEntry,
    outcome: GateOutcome,
    meta: { args?: Record<string, unknown>; reason?: string; decidedBy?: string } = {},
  ): void {
    if (!this.pending.has(entry.gate.id)) return;
    this.pending.delete(entry.gate.id);
    if (entry.abortHandler && entry.abortSignal) {
      entry.abortSignal.removeEventListener('abort', entry.abortHandler);
    }

    const decision: GateDecision =
      outcome === 'approve'
        ? { kind: 'approve', args: meta.args, reason: meta.reason, decidedBy: meta.decidedBy }
        : outcome === 'reject'
          ? { kind: 'reject', reason: meta.reason, decidedBy: meta.decidedBy }
          : { kind: 'reject', reason: meta.reason ?? `gate ${outcome}` };

    entry.resolve(decision);
    this.channel?.appendLine(
      `[gate] resolved ${entry.gate.id} outcome=${outcome}${meta.decidedBy ? ` by=${meta.decidedBy}` : ''}`,
    );
    this.resolvedEmitter.fire({
      id: entry.gate.id,
      gate: entry.gate,
      outcome,
      reason: meta.reason,
      decidedBy: meta.decidedBy,
    });
  }
}
