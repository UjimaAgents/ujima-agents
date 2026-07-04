import { z } from 'zod';
import type { AgentDelegateResult, OrchestratorTool, ToolExecutionContext } from './types.js';
import { DELEGATE_KINDS } from '../utils/delegate-turn.js';

// -----------------------------------------------------------------------
// New action schema (Task 5)
// -----------------------------------------------------------------------

const NEW_ACTIONS = ['start', 'start_many', 'status', 'join', 'read', 'stop', 'send'] as const;
const DEPRECATED_ACTIONS = ['spawn', 'wait'] as const;
const ALL_ACTIONS = [...NEW_ACTIONS, ...DEPRECATED_ACTIONS] as const;

const DelegateKindSchema = z.enum(DELEGATE_KINDS);

const StartTaskSchema = z.object({
  target: z.string().min(1).describe('Target agent name or id.'),
  task: z.string().min(1).describe('Task message for the delegate.'),
  mode: DelegateKindSchema.optional().describe('worker (default) or explorer.'),
  label: z.string().optional().describe('Optional human-readable label for the child task.'),
});

const DelegateExecutionSchema = z.enum(['blocking', 'non_blocking']);

const AgentDelegateSchema = z.object({
  action: z.enum(ALL_ACTIONS).default('start').describe(
    'start — create a child task and delegate. start_many — batch version. '
    + 'status — check task status. join — wait for completion. '
    + 'read — pull thread messages. stop — cancel task. '
    + 'send — send follow-up message. '
    + 'Deprecated: spawn → start, wait → join.',
  ),
  // New-style params
  target: z.string().min(1).optional().describe('Target agent name or id (start).'),
  task: z.string().min(1).optional().describe('Task message (start).'),
  mode: DelegateKindSchema.optional().describe('worker (default) or explorer.'),
  execution: DelegateExecutionSchema.optional().describe('blocking (default) waits for the result. non_blocking dispatches child work and lets it continue in parallel.'),
  label: z.string().optional().describe('Optional label for the child task.'),
  timeout_ms: z.number().positive().optional().describe('Timeout in ms (join). Default 120s.'),
  task_id: z.string().optional().describe('Single task id (status, join, read, stop, send).'),
  task_ids: z.array(z.string()).optional().describe('Multiple task ids (status, join, stop).'),
  cursor: z.string().optional().describe('Pagination cursor (read).'),
  message: z.string().optional().describe('Follow-up message (send).'),
  tasks: z.array(StartTaskSchema).optional().describe('Tasks array (start_many).'),
  // Deprecated legacy params (still accepted for backwards compat)
  to: z.string().min(1).optional().describe('Deprecated: use target instead.'),
  delegates: z.array(z.object({
    to: z.string().min(1).describe('Target agent name or id.'),
    message: z.string().min(1).describe('Task message.'),
    kind: DelegateKindSchema.optional(),
  })).optional().describe('Deprecated: use tasks instead.'),
  delegate_id: z.string().optional().describe('Deprecated: use task_id instead.'),
  delegate_ids: z.array(z.string()).optional().describe('Deprecated: use task_ids instead.'),
});

type AgentDelegateArgs = z.infer<typeof AgentDelegateSchema>;

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function resolveTargetOrThrow(args: AgentDelegateArgs): string {
  return args.target ?? args.to ?? (() => { throw new Error('start action requires a target (or deprecated to).'); })();
}

function resolveTaskOrThrow(args: AgentDelegateArgs): string {
  return args.task ?? args.message ?? (() => { throw new Error('start action requires a task message.'); })();
}

function resolveTaskIdOrThrow(args: AgentDelegateArgs): string {
  return args.task_id ?? args.delegate_id ?? (() => { throw new Error(`action "${args.action}" requires task_id (or deprecated delegate_id).`); })();
}

function resolveTaskIdsOrThrow(args: AgentDelegateArgs): string[] {
  return args.task_ids ?? (args.task_id ? [args.task_id] : args.delegate_ids ?? (args.delegate_id ? [args.delegate_id] : []));
}

function summarizeDelegateResult(result: AgentDelegateResult) {
  return {
    task_id: result.message_id,
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
  ctx.repo.saveRun?.({ ...run, step, summary });
}

// -----------------------------------------------------------------------
// Main execute function
// -----------------------------------------------------------------------

async function executeDelegate(ctx: ToolExecutionContext, args: AgentDelegateArgs): Promise<unknown> {
  const orgId = ctx.invocation.organizationId;
  const action: string = args.action;

  // Map deprecated actions to new ones. `spawn` with delegates → start_many.
  const useDelegates = (args.delegates?.length ?? 0) > 0;
  const normalizedAction: string = action === 'spawn' && !useDelegates ? 'start'
    : action === 'spawn' && useDelegates ? 'start_many'
    : action === 'wait' ? 'join'
    : action;

  switch (normalizedAction) {
    // ── start ────────────────────────────────────────────────────────
    case 'start': {
      const target = resolveTargetOrThrow(args);
      const msg = resolveTaskOrThrow(args);
      const execution = args.execution ?? 'blocking';
      updateParentRunStep(
        ctx,
        execution === 'non_blocking' ? 'delegate_dispatch' : 'delegate_wait',
        execution === 'non_blocking'
          ? `Delegated to ${target}; continuing while child task runs`
          : `Delegated to ${target}; waiting for result`,
      );

      const result: AgentDelegateResult = await ctx.delegateAgentTurn({
        organizationId: orgId,
        fromMemberId: ctx.invocation.memberId,
        to: target,
        message: msg,
        kind: args.mode,
        index: 0,
        runId: ctx.invocation.runId,
        mode: execution,
        timeoutMs: args.timeout_ms,
      });

      updateParentRunStep(ctx, 'running', 'Delegate result received');
      return {
        task_id: result.message_id,
        thread_id: result.thread_id,
        agent_id: result.agent_id,
        agent: result.agent,
        status: result.status,
        reply_content: result.reply_content,
        error: result.error,
      };
    }

    // ── start_many ────────────────────────────────────────────────────
    case 'start_many': {
      const tasks = args.tasks ?? (args.delegates?.map((d) => ({ target: d.to, task: d.message, mode: d.kind })) ?? []);
      if (tasks.length === 0) throw new Error('start_many requires a non-empty tasks array.');
      const execution = args.execution ?? 'blocking';

      updateParentRunStep(
        ctx,
        execution === 'non_blocking' ? 'delegate_dispatch' : 'delegate_wait',
        execution === 'non_blocking'
          ? `Delegated ${tasks.length} tasks; continuing while child tasks run`
          : `Delegated ${tasks.length} tasks; waiting for results`,
      );

      const results: AgentDelegateResult[] = [];
      for (const [index, taskDef] of tasks.entries()) {
        results.push(await ctx.delegateAgentTurn({
          organizationId: orgId,
          fromMemberId: ctx.invocation.memberId,
          to: taskDef.target,
          message: taskDef.task,
          kind: taskDef.mode ?? args.mode,
          index,
          runId: ctx.invocation.runId,
          mode: execution,
          timeoutMs: args.timeout_ms,
        }));
      }

      updateParentRunStep(ctx, 'running', `Delegate results received (${results.length})`);
      const details = results.map(summarizeDelegateResult);
      return {
        status: summarizeBatchStatus(results),
        task_ids: details.map((d) => d.task_id),
        details,
      };
    }

    // ── status ────────────────────────────────────────────────────────
    case 'status': {
      const ids = resolveTaskIdsOrThrow(args);
      if (ids.length === 1) {
        const [id] = ids;
        if (!id) throw new Error('status requires task_id or task_ids.');
        const result = await ctx.getDelegateStatus(orgId, id);
        return summarizeDelegateResult(result);
      }
      const results = await Promise.all(ids.map((id) => ctx.getDelegateStatus(orgId, id)));
      return { results: results.map(summarizeDelegateResult) };
    }

    // ── join ──────────────────────────────────────────────────────────
    case 'join': {
      const ids = resolveTaskIdsOrThrow(args);
      if (ids.length === 0) throw new Error('join requires task_id or task_ids.');
      const results = await ctx.waitForDelegates(orgId, ids, args.timeout_ms);
      return { results: results.map(summarizeDelegateResult) };
    }

    // ── read ──────────────────────────────────────────────────────────
    case 'read': {
      const taskId = resolveTaskIdOrThrow(args);
      const messages = await ctx.readDelegateThread(orgId, taskId);
      return { task_id: taskId, messages };
    }

    // ── stop ──────────────────────────────────────────────────────────
    case 'stop': {
      const ids = resolveTaskIdsOrThrow(args);
      if (ids.length === 1) {
        const [id] = ids;
        if (!id) throw new Error('stop requires task_id or task_ids.');
        return ctx.stopDelegate(orgId, id);
      }
      const results = await Promise.all(ids.map((id) => ctx.stopDelegate(orgId, id)));
      return { results };
    }

    // ── send ──────────────────────────────────────────────────────────
    case 'send': {
      const taskId = resolveTaskIdOrThrow(args);
      const msg = resolveTaskOrThrow(args);
      if (!msg) throw new Error('send action requires a message.');
      return ctx.sendToDelegate(orgId, taskId, msg, ctx.invocation.memberId);
    }

    default:
      throw new Error(`Unknown delegate action: ${action}`);
  }
}

// -----------------------------------------------------------------------
// Exported tool
// -----------------------------------------------------------------------

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
