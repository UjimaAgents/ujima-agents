import { z } from 'zod';
import { WorkflowTransitionActionSchema } from '@ujima/shared';
import type { OrchestratorTool } from './types.js';

// ---------------------------------------------------------------------------
// workflow.* tools
//
// - run / transition / advance drive the engine (require ctx.workflowEngine,
//   wired at the composition root). The engine is the single authority over
//   run state: advance passes the envelope to `engine.advance`, and the
//   completion hook routes terminal agent runs through the engine — no tool
//   writes node-run rows.
// - list / view read definitions from the repo.
// ---------------------------------------------------------------------------

const ENGINE_UNAVAILABLE = 'workflow engine is not available in this context';

const RunSchema = z.object({
  name: z.string().min(1),
  input: z.string().default(''),
});

const ListSchema = z.object({});

const ViewSchema = z.object({
  name: z.string().min(1),
});

const AdvanceSchema = z.object({
  summary: z.string().min(1),
  output_path: z.string().optional(),
  json: z.unknown().optional(),
  idempotency_key: z.string().optional(),
});

const TransitionSchema = z.object({
  run_id: z.string().min(1),
  action: WorkflowTransitionActionSchema,
  idempotency_key: z.string().min(1),
  rejection_reason: z.string().optional(),
});

export const workflowRunTool: OrchestratorTool<typeof RunSchema> = {
  id: 'workflow.run',
  schema: RunSchema,
  toInvocation: (args) => ({
    action: 'create',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, repo, workflowEngine }) => {
    if (!workflowEngine) return { ok: false, error: ENGINE_UNAVAILABLE };
    const input = invocation.input as z.infer<typeof RunSchema>;
    const threadId = invocation.threadId;
    if (!threadId) return { ok: false, error: 'workflow.run requires a thread context' };
    const channelId =
      repo.getThread(invocation.organizationId, threadId)?.channelId ?? threadId;
    try {
      const { workflowRunId } = await workflowEngine.startRun({
        organizationId: invocation.organizationId,
        definitionName: input.name,
        input: input.input,
        initiatedBy: invocation.memberId,
        channelId,
        threadId,
      });
      return { ok: true, workflow_run_id: workflowRunId };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const workflowListTool: OrchestratorTool<typeof ListSchema> = {
  id: 'workflow.list',
  schema: ListSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, repo }) => {
    const defs = repo.listWorkflowDefinitions(invocation.organizationId);
    return {
      workflows: defs.map((d) => ({
        name: d.name,
        description: d.description ?? '',
        node_count: d.nodes.length,
      })),
    };
  },
};

export const workflowViewTool: OrchestratorTool<typeof ViewSchema> = {
  id: 'workflow.view',
  schema: ViewSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, repo }) => {
    const input = invocation.input as z.infer<typeof ViewSchema>;
    const def = repo.getWorkflowDefinitionByName(invocation.organizationId, input.name);
    if (!def) return { ok: false, error: `workflow "${input.name}" not found` };
    return {
      ok: true,
      name: def.name,
      description: def.description ?? '',
      graph: { nodes: def.nodes, edges: def.edges },
    };
  },
};

export const workflowAdvanceTool: OrchestratorTool<typeof AdvanceSchema> = {
  id: 'workflow.advance',
  schema: AdvanceSchema,
  toInvocation: (args) => ({
    action: 'update',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, workflowEngine }) => {
    if (!workflowEngine) return { ok: false, error: ENGINE_UNAVAILABLE };
    const input = invocation.input as z.infer<typeof AdvanceSchema>;
    const runId = invocation.runId;
    if (!runId) return { ok: false, error: 'workflow.advance can only be called inside a run' };
    const result = await workflowEngine.advance({
      organizationId: invocation.organizationId,
      runId,
      summary: input.summary,
      json: input.json,
      outputPath: input.output_path,
      idempotencyKey: input.idempotency_key,
    });
    return result.ok
      ? { ok: true }
      : { ok: false, error: result.error ?? 'advance failed' };
  },
};

export const workflowTransitionTool: OrchestratorTool<typeof TransitionSchema> = {
  id: 'workflow.transition',
  schema: TransitionSchema,
  toInvocation: (args) => ({
    action: 'update',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, workflowEngine }) => {
    if (!workflowEngine) return { ok: false, error: ENGINE_UNAVAILABLE };
    const input = invocation.input as z.infer<typeof TransitionSchema>;
    const result = await workflowEngine.transition({
      organizationId: invocation.organizationId,
      workflowRunId: input.run_id,
      action: input.action,
      idempotencyKey: input.idempotency_key,
      rejectionReason: input.rejection_reason,
    });
    return { ok: result.ok, idempotent: result.idempotent };
  },
};

export const WORKFLOW_TOOLS = {
  'workflow.run': workflowRunTool,
  'workflow.list': workflowListTool,
  'workflow.view': workflowViewTool,
  'workflow.advance': workflowAdvanceTool,
  'workflow.transition': workflowTransitionTool,
} as const;
