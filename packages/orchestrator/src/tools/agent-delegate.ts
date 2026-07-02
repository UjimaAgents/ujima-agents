import { z } from 'zod';
import type { AgentDelegateResult, OrchestratorTool, ToolExecutionContext } from './types.js';
import { DELEGATE_KINDS, type DelegateKind } from '../utils/delegate-turn.js';

const DELEGATE_ACTIONS = ['spawn', 'status', 'wait', 'stop', 'read', 'send'] as const;
const DelegateKindSchema = z.enum(DELEGATE_KINDS);

const AgentDelegateSchema = z.object({
  kind: DelegateKindSchema.default('worker').describe('Use with spawn. worker = edit/write tasks. explorer = read-only investigation.'),
  action: z.enum(DELEGATE_ACTIONS).default('spawn').describe(
    'spawn creates a new delegate. status checks one delegate_id. wait blocks on delegate_ids. stop cancels one delegate_id. read pulls thread messages. send follows up one delegate_id.',
  ),
  to: z.string().min(1).optional().describe('Target agent name or id for spawn. Must match an active agent and cannot be yourself.'),
  message: z.string().min(1).optional().describe('Task message for spawn or send.'),
  delegates: z.array(z.object({
    to: z.string().min(1).describe('Target agent name or id for spawn. Must match an active agent and cannot be yourself.'),
    message: z.string().min(1).describe('Task message for that spawned delegate.'),
    kind: DelegateKindSchema.optional().describe('Use only for spawn. worker = edit/write tasks. explorer = read-only investigation.'),
  })).optional().describe('Batch spawn only. Each entry returns its own delegate id and result. Same-agent tasks run serially.'),
  delegate_id: z.string().optional().describe('Single delegate id for status, stop, read, or send.'),
  delegate_ids: z.array(z.string()).optional().describe('Delegate ids for wait.'),
  timeout_ms: z.number().positive().optional().describe('Wait timeout in ms. Default 120s.'),
});

type AgentDelegateArgs = z.infer<typeof AgentDelegateSchema>;

function normalizeSpawnArgs(args: AgentDelegateArgs): { to: string; message: string; kind?: DelegateKind }[] {
  if (args.delegates && args.delegates.length > 0) return args.delegates;
  if (args.message && args.to) return [{ to: args.to, message: args.message, kind: args.kind }];
  throw new Error('spawn action requires a target agent and message.');
}

function requireDelegateId(args: AgentDelegateArgs): string {
  if (!args.delegate_id) throw new Error(`delegate action "${args.action}" requires delegate_id.`);
  return args.delegate_id;
}

function summarizeDelegateResult(result: AgentDelegateResult) {
  return {
    delegate_id: result.message_id,
    delegate_index: result.delegate_index,
    agent: result.agent,
    agent_id: result.agent_id,
    thread_id: result.thread_id,
    status: result.status,
    reply_id: result.reply_id,
    reply_content: result.reply_content,
    error: result.error,
  };
}

function summarizeBatchStatus(results: AgentDelegateResult[]): string {
  if (results.every((result) => result.status === 'completed')) return 'completed';
  if (results.some((result) => result.status === 'waiting_for_approval' || result.status === 'waiting_for_input')) {
    return 'waiting';
  }
  if (results.some((result) => result.status === 'delegate_failed')) return 'delegate_failed';
  if (results.some((result) => result.status === 'timed_out')) return 'timed_out';
  return 'partial';
}

function updateParentRunStep(ctx: ToolExecutionContext, step: string, summary: string): void {
  const run = ctx.repo.getRun(ctx.invocation.organizationId, ctx.invocation.runId);
  if (!run) return;
  ctx.repo.saveRun({ ...run, step, summary });
}

async function executeDelegate(ctx: ToolExecutionContext, args: AgentDelegateArgs): Promise<unknown> {
  const orgId = ctx.invocation.organizationId;

  switch (args.action) {
    case 'spawn': {
      const tasks = normalizeSpawnArgs(args);
      updateParentRunStep(ctx, 'delegate_wait', `Delegated ${tasks.length} task${tasks.length === 1 ? '' : 's'}; waiting for results`);
      const results: AgentDelegateResult[] = [];
      for (const [index, task] of tasks.entries()) {
        results.push(await ctx.delegateAgentTurn({
          organizationId: orgId,
          fromMemberId: ctx.invocation.memberId,
          to: task.to,
          message: task.message,
          kind: task.kind ?? args.kind,
          index,
          runId: ctx.invocation.runId,
          mode: 'blocking',
          timeoutMs: args.timeout_ms,
        }));
      }
      updateParentRunStep(ctx, 'running', `Delegate results received (${results.length})`);
      const details = results.map(summarizeDelegateResult);
      return {
        status: summarizeBatchStatus(results),
        delegate_ids: details.map((detail) => detail.delegate_id),
        details,
      };
    }

    case 'status':
      return ctx.getDelegateStatus(orgId, requireDelegateId(args));

    case 'wait': {
      const ids = args.delegate_ids ?? (args.delegate_id ? [args.delegate_id] : []);
      if (ids.length === 0) throw new Error('delegate action "wait" requires delegate_id or delegate_ids.');
      const results = await ctx.waitForDelegates(orgId, ids, args.timeout_ms);
      return { results: results.map(summarizeDelegateResult) };
    }

    case 'stop':
      return ctx.stopDelegate(orgId, requireDelegateId(args));

    case 'read': {
      const delegateId = requireDelegateId(args);
      const messages = await ctx.readDelegateThread(orgId, delegateId);
      return { delegate_id: delegateId, messages };
    }

    case 'send': {
      const delegateId = requireDelegateId(args);
      if (!args.message) throw new Error('delegate action "send" requires a message.');
      return ctx.sendToDelegate(orgId, delegateId, args.message, ctx.invocation.memberId);
    }

    default: {
      const _exhaustive: never = args.action;
      throw new Error(`Unknown delegate action: ${_exhaustive}`);
    }
  }
}

export const agentDelegateTool: OrchestratorTool<typeof AgentDelegateSchema> = {
  id: 'agent.delegate',
  schema: AgentDelegateSchema,
  toInvocation: (args) => ({
    action: 'execute',
    resourceType: 'mcp',
    input: args as unknown as Record<string, unknown>,
  }),
  execute: (ctx) => executeDelegate(ctx, ctx.invocation.input as unknown as AgentDelegateArgs),
};
