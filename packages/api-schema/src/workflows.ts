import { IdSchema, TimestampSchema, WorkflowNodeRunSchema, WorkflowRunSchema } from '@ujima/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Workflow run views — the single wire contract for every run-detail surface.
//
// Producer: `buildWorkflowRunView` / `buildWorkflowApprovalView` in the
// transport layer. Consumers: the web run-detail panels and approval pill.
// These schemas derive from the canonical @ujima/shared run schemas and only
// ADD view-only fields (agentName, failureDetail, toolSteps, ...), per
// ADR 0002 §9 (api-schema adds, never mutates). Round-trip tests in
// `workflows.test.ts` pin the wire shape.
// ---------------------------------------------------------------------------

/** One bound child-run step, projected for the run-detail tool timeline. */
export const WorkflowToolStepViewSchema = z.object({
  tool: z.string(),
  action: z.string(),
  status: z.string(),
  resourcePath: z.string().optional(),
  at: TimestampSchema,
});
export type WorkflowToolStepView = z.infer<typeof WorkflowToolStepViewSchema>;

/**
 * A node run with its view-only decorations. `toolSteps` is ALWAYS present on
 * the wire (the producer emits `[]` for nodes without a child run) — this
 * requiredness is the contract; optionality here would be drift.
 */
export const WorkflowNodeRunViewSchema = WorkflowNodeRunSchema.extend({
  agentName: z.string().optional(),
  failureDetail: z.string().optional(),
  toolSteps: z.array(WorkflowToolStepViewSchema),
});
export type WorkflowNodeRunView = z.infer<typeof WorkflowNodeRunViewSchema>;

/** A thread message projected onto the run timeline (status cards removed). */
export const WorkflowRunMessageViewSchema = z.object({
  id: IdSchema,
  senderName: z.string(),
  senderKind: z.string(),
  content: z.string(),
  createdAt: TimestampSchema,
});
export type WorkflowRunMessageView = z.infer<typeof WorkflowRunMessageViewSchema>;

/** A pending tool approval that is blocking one of this run's agent nodes. */
export const WorkflowBlockingApprovalViewSchema = z.object({
  id: IdSchema,
  nodeId: z.string().optional(),
  agentName: z.string().optional(),
  resourceType: z.string(),
  action: z.string(),
  resourcePath: z.string(),
});
export type WorkflowBlockingApprovalView = z.infer<typeof WorkflowBlockingApprovalViewSchema>;

/** The bounded run snapshot served by `GET /api/workflow-runs/:id`. */
export const WorkflowRunViewSchema = z.object({
  run: WorkflowRunSchema,
  nodeRuns: z.array(WorkflowNodeRunViewSchema),
  messages: z.array(WorkflowRunMessageViewSchema),
  blockingApprovals: z.array(WorkflowBlockingApprovalViewSchema),
});
export type WorkflowRunView = z.infer<typeof WorkflowRunViewSchema>;

/** An approval gate (approval node) awaiting resolution, served by `/api/workflow-approvals`. */
export const WorkflowApprovalViewSchema = z.object({
  id: IdSchema,
  workflowRunId: IdSchema,
  workflowName: z.string(),
  nodeId: z.string(),
  prompt: z.string(),
  priorSummary: z.string().optional(),
  priorOutputPath: z.string().optional(),
  channelId: IdSchema,
  requestedBy: IdSchema,
  createdAt: TimestampSchema,
});
export type WorkflowApprovalView = z.infer<typeof WorkflowApprovalViewSchema>;

/** A tool approval (write/MCP) blocking a running workflow's agent step. */
export const WorkflowToolApprovalViewSchema = z.object({
  id: IdSchema,
  workflowRunId: IdSchema,
  workflowName: z.string(),
  nodeId: z.string(),
  /** Stable member id of the requesting agent (agentName is display-only). */
  requestedByMemberId: IdSchema.optional(),
  agentName: z.string(),
  resourceType: z.string(),
  action: z.string(),
  resourcePath: z.string(),
  channelId: IdSchema,
  createdAt: TimestampSchema,
});
export type WorkflowToolApprovalView = z.infer<typeof WorkflowToolApprovalViewSchema>;

/** Response shape of `GET /api/workflow-approvals`. */
export const WorkflowApprovalsResponseSchema = z.object({
  approvals: z.array(WorkflowApprovalViewSchema),
  toolApprovals: z.array(WorkflowToolApprovalViewSchema),
});
export type WorkflowApprovalsResponse = z.infer<typeof WorkflowApprovalsResponseSchema>;