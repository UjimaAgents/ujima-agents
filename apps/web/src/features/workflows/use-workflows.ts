"use client";

import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowTransitionAction,
} from "@ujima/shared";
import { ClientApiError, clientFetchJson, clientFetchVoid } from "@/lib/client-api";

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

async function request<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  try {
    return await clientFetchJson<T>(url, init, fallback);
  } catch (error) {
    if (error instanceof ClientApiError) {
      const body = error.body as { issues?: WorkflowValidationIssue[] } | null;
      throw new WorkflowApiError(error.message, error.status, body?.issues);
    }
    throw error;
  }
}

async function requestVoid(url: string, init: RequestInit, fallback: string): Promise<void> {
  try {
    await clientFetchVoid(url, init, fallback);
  } catch (error) {
    if (error instanceof ClientApiError) {
      throw new WorkflowApiError(error.message, error.status);
    }
    throw error;
  }
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
  return request("/api/workflow-catalog", { cache: "no-store" }, "Unable to load workflow catalog.");
}

export async function listWorkflows(channelId?: string): Promise<WorkflowDefinition[]> {
  const url = channelId ? `/api/workflows?channelId=${encodeURIComponent(channelId)}` : "/api/workflows";
  const body = await request<{ workflows: WorkflowDefinition[] }>(url, { cache: "no-store" }, "Unable to list workflows.");
  return body.workflows;
}

export async function runWorkflow(
  id: string,
  input: string,
  channelId: string,
  threadId: string,
): Promise<{ workflow_run_id: string }> {
  return request(`/api/workflows/${encodeURIComponent(id)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, channelId, threadId }),
  }, "Unable to start workflow.");
}

export async function getWorkflow(id: string): Promise<WorkflowDefinition> {
  const body = await request<{ workflow: WorkflowDefinition }>(
    `/api/workflows/${encodeURIComponent(id)}`,
    { cache: "no-store" },
    "Unable to load workflow.",
  );
  return body.workflow;
}

export async function createWorkflow(input: WorkflowInput): Promise<WorkflowDefinition> {
  const body = await request<{ workflow: WorkflowDefinition }>("/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "Unable to create workflow.");
  return body.workflow;
}

export async function updateWorkflow(id: string, input: WorkflowInput): Promise<WorkflowDefinition> {
  const body = await request<{ workflow: WorkflowDefinition }>(`/api/workflows/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "Unable to save workflow.");
  return body.workflow;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await requestVoid(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" }, "Unable to delete workflow.");
}

// --- Runs -----------------------------------------------------------------

export async function listWorkflowRuns(status?: string): Promise<WorkflowRun[]> {
  const url = status ? `/api/workflow-runs?status=${encodeURIComponent(status)}` : "/api/workflow-runs";
  const body = await request<{ runs: WorkflowRun[] }>(url, { cache: "no-store" }, "Unable to list workflow runs.");
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
  await request(`/api/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId,
      resolution,
      reason: `Resolved from workflow run view (${resolution}).`,
    }),
  }, "Unable to resolve approval.");
}

export async function getWorkflowRun(id: string): Promise<WorkflowRunDetail> {
  return request(`/api/workflow-runs/${encodeURIComponent(id)}`, { cache: "no-store" }, "Unable to load workflow run.");
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
  return request(
    `/api/workflow-runs/${encodeURIComponent(runId)}/artifact?path=${encodeURIComponent(path)}`,
    { cache: "no-store" },
    "Unable to load artifact.",
  );
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

/** A tool approval (write/MCP) blocking a running workflow's agent step. */
export interface WorkflowToolApproval {
  id: string;
  workflowRunId: string;
  workflowName: string;
  nodeId: string;
  /** Stable member id of the requesting agent (agentName is display-only). */
  requestedByMemberId?: string;
  agentName: string;
  resourceType: string;
  action: string;
  resourcePath: string;
  channelId: string;
  createdAt: string;
}

export async function listWorkflowApprovals(): Promise<{
  approvals: WorkflowApproval[];
  toolApprovals: WorkflowToolApproval[];
}> {
  const body = await request<{ approvals: WorkflowApproval[]; toolApprovals?: WorkflowToolApproval[] }>(
    "/api/workflow-approvals",
    { cache: "no-store" },
    "Unable to load workflow approvals.",
  );
  return { approvals: body.approvals ?? [], toolApprovals: body.toolApprovals ?? [] };
}

export async function transitionWorkflowRun(
  id: string,
  action: WorkflowTransitionAction,
  rejectionReason?: string,
  idempotencyKey?: string,
): Promise<void> {
  const key = idempotencyKey ?? `wf-trans-${id}-${action}`;
  await request(`/api/workflow-runs/${encodeURIComponent(id)}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      idempotency_key: key,
      rejection_reason: rejectionReason,
    }),
  }, "Unable to update workflow run.");
}
