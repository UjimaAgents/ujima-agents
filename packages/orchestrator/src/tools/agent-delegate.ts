import { z } from 'zod';
import type { AgentDelegateResult, OrchestratorTool, ToolExecutionContext } from './types.js';
import { DELEGATE_KINDS, type DelegateKind } from '../utils/delegate-turn.js';

const DELEGATE_ACTIONS = ['spawn', 'status', 'wait', 'stop', 'read', 'send'] as const;
const DelegateKindSchema = z.enum(DELEGATE_KINDS);

const AgentDelegateSchema = z.object({
  kind: DelegateKindSchema.default('worker').describe('worker: edit/write tasks. explorer: read-only investigation.'),
  action: z.enum(DELEGATE_ACTIONS).default('spawn').describe(
    'spawn: fire delegates and return ids immediately. status: check one by id. wait: block for results. stop: cancel. read: pull thread messages. send: follow-up DM.',
  ),
  to: z.string().min(1).optional().describe('Target agent name or id (backward compat + single-spawn).'),
  message: z.string().min(1).optional().describe('Task message (spawn / send).'),
  delegates: z.array(z.object({
    to: z.string().min(1).describe('Agent name or id.'),
    message: z.string().min(1).describe('Task message.'),
    kind: DelegateKindSchema.optional().describe('worker: edit/write tasks. explorer: read-only investigation.'),
  })).optional().describe('Multiple delegates to spawn at once.'),
  delegate_id: z.string().optional().describe('Delegate message id (status / wait / stop / read / send).'),
  delegate_ids: z.array(z.string()).optional().describe('Multiple delegate ids (wait).'),
  timeout_ms: z.number().positive().optional().describe('Max wait time in ms (default 120s).'),
});

type AgentDelegateArgs = z.infer<typeof AgentDelegateSchema>;

function normalizeSpawnArgs(args: AgentDelegateArgs): { to: string; message: string; kind?: DelegateKind }[] {
  if (args.delegates && args.delegates.length > 0) return args.delegates;
  if (args.to && args.message) return [{ to: args.to, message: args.message, kind: args.kind }];
  throw new Error('spawn action requires either (to + message) or a delegates array.');
}

function requireDelegateId(args: AgentDelegateArgs): string {
  if (!args.delegate_id) throw new Error(`delegate action "${args.action}" requires delegate_id.`);
  return args.delegate_id;
}

function summarizeDelegateResult(result: AgentDelegateResult) {
  return {
    delegate_id: result.message_id,
    agent: result.agent,
    agent_id: result.agent_id,
    thread_id: result.thread_id,
    status: result.status,
    reply_id: result.reply_id,
    reply_content: result.reply_content,
    error: result.error,
  };
}

async function executeDelegate(ctx: ToolExecutionContext, args: AgentDelegateArgs): Promise<unknown> {
  const orgId = ctx.invocation.organizationId;

  switch (args.action) {
    case 'spawn': {
      const results = await Promise.all(
        normalizeSpawnArgs(args).map((task) =>
          ctx.delegateAgentTurn({
            organizationId: orgId,
            fromMemberId: ctx.invocation.memberId,
            to: task.to,
            message: task.message,
            kind: task.kind ?? args.kind,
            runId: ctx.invocation.runId,
            mode: 'non_blocking',
          }),
        ),
      );
      const details = results.map(summarizeDelegateResult);
      return { delegate_ids: details.map((detail) => detail.delegate_id), details };
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
