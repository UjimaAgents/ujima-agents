"use client";

import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowTransitionAction,
} from "@ujima/shared";

export interface WorkflowInput {
  name: string;
  description?: string;
  channelId?: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowValidationIssue {
  code: string;
  message: string;
}

export class WorkflowApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: WorkflowValidationIssue[],
  ) {
    super(message);
    this.name = "WorkflowApiError";
  }
}

async function parse<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    | (T & { message?: string; issues?: WorkflowValidationIssue[] })
    | null;
  if (!res.ok) {
    throw new WorkflowApiError(body?.message ?? fallback, res.status, body?.issues);
  }
  return body as T;
}

export interface WorkflowAgent {
  id: string;
  name: string;
  role: string;
}
export interface WorkflowTool {
  id: string;
  label: string;
  group: string;
}
export interface WorkflowSkill {
  name: string;
  description: string;
}
export interface WorkflowCatalog {
  agents: WorkflowAgent[];
  tools: WorkflowTool[];
  skills: WorkflowSkill[];
}

export async function getWorkflowCatalog(): Promise<WorkflowCatalog> {
  const res = await fetch("/api/workflow-catalog", { cache: "no-store" });
  return parse<WorkflowCatalog>(res, "Unable to load workflow catalog.");
}

export async function listWorkflows(channelId?: string): Promise<WorkflowDefinition[]> {
  const url = channelId ? `/api/workflows?channelId=${encodeURIComponent(channelId)}` : "/api/workflows";
  const res = await fetch(url, { cache: "no-store" });
  const body = await parse<{ workflows: WorkflowDefinition[] }>(res, "Unable to list workflows.");
  return body.workflows;
}

export async function runWorkflow(
  id: string,
  input: string,
  channelId: string,
  threadId: string,
): Promise<{ workflow_run_id: string }> {
  const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, channelId, threadId }),
  });
  return parse<{ workflow_run_id: string }>(res, "Unable to start workflow.");
}

export async function getWorkflow(id: string): Promise<WorkflowDefinition> {
  const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, { cache: "no-store" });
  const body = await parse<{ workflow: WorkflowDefinition }>(res, "Unable to load workflow.");
  return body.workflow;
}

export async function createWorkflow(input: WorkflowInput): Promise<WorkflowDefinition> {
  const res = await fetch("/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await parse<{ workflow: WorkflowDefinition }>(res, "Unable to create workflow.");
  return body.workflow;
}

export async function updateWorkflow(id: string, input: WorkflowInput): Promise<WorkflowDefinition> {
  const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await parse<{ workflow: WorkflowDefinition }>(res, "Unable to save workflow.");
  return body.workflow;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await fetch(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new WorkflowApiError("Unable to delete workflow.", res.status);
  }
}

// --- Runs -----------------------------------------------------------------

export async function listWorkflowRuns(status?: string): Promise<WorkflowRun[]> {
  const url = status ? `/api/workflow-runs?status=${encodeURIComponent(status)}` : "/api/workflow-runs";
  const res = await fetch(url, { cache: "no-store" });
  const body = await parse<{ runs: WorkflowRun[] }>(res, "Unable to list workflow runs.");
  return body.runs;
}

export interface WorkflowRunMessage {
  id: string;
  senderName: string;
  senderKind: string;
  content: string;
  createdAt: string;
}
export interface WorkflowToolStep {
  tool: string;
  action: string;
  status: string;
  resourcePath?: string;
  at: string;
}
export type WorkflowNodeRunView = WorkflowNodeRun & {
  agentName?: string;
  failureDetail?: string;
  toolSteps?: WorkflowToolStep[];
};

export interface WorkflowBlockingApproval {
  id: string;
  nodeId?: string;
  agentName?: string;
  resourceType: string;
  action: string;
  resourcePath: string;
}

export interface WorkflowRunDetail {
  run: WorkflowRun;
  nodeRuns: WorkflowNodeRunView[];
  messages: WorkflowRunMessage[];
  blockingApprovals: WorkflowBlockingApproval[];
}

/** Resolve a tool approval that is blocking a workflow's agent step. */
export async function resolveBlockingApproval(
  approvalId: string,
  organizationId: string,
  resolution: "allow_once" | "reject",
): Promise<void> {
  const res = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId,
      resolution,
      reason: `Resolved from workflow run view (${resolution}).`,
    }),
  });
  await parse<unknown>(res, "Unable to resolve approval.");
}

export async function getWorkflowRun(id: string): Promise<WorkflowRunDetail> {
  const res = await fetch(`/api/workflow-runs/${encodeURIComponent(id)}`, { cache: "no-store" });
  return parse<WorkflowRunDetail>(res, "Unable to load workflow run.");
}

export interface WorkflowRunArtifact {
  path: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
}

export async function getWorkflowRunArtifact(
  runId: string,
  path: string,
): Promise<WorkflowRunArtifact> {
  const res = await fetch(
    `/api/workflow-runs/${encodeURIComponent(runId)}/artifact?path=${encodeURIComponent(path)}`,
    { cache: "no-store" },
  );
  return parse<WorkflowRunArtifact>(res, "Unable to load artifact.");
}

export interface WorkflowApproval {
  id: string;
  workflowRunId: string;
  workflowName: string;
  nodeId: string;
  prompt: string;
  priorSummary?: string;
  priorOutputPath?: string;
  channelId: string;
  requestedBy: string;
  createdAt: string;
}

export async function listWorkflowApprovals(): Promise<WorkflowApproval[]> {
  const res = await fetch("/api/workflow-approvals", { cache: "no-store" });
  const body = await parse<{ approvals: WorkflowApproval[] }>(res, "Unable to load workflow approvals.");
  return body.approvals;
}

export async function transitionWorkflowRun(
  id: string,
  action: WorkflowTransitionAction,
  rejectionReason?: string,
): Promise<void> {
  const res = await fetch(`/api/workflow-runs/${encodeURIComponent(id)}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      idempotency_key: `${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      rejection_reason: rejectionReason,
    }),
  });
  await parse<unknown>(res, "Unable to update workflow run.");
}
