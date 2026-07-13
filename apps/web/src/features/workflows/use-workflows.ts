"use client";

import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@ujima/shared";

export interface WorkflowInput {
  name: string;
  description?: string;
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

export async function listWorkflows(): Promise<WorkflowDefinition[]> {
  const res = await fetch("/api/workflows", { cache: "no-store" });
  const body = await parse<{ workflows: WorkflowDefinition[] }>(res, "Unable to list workflows.");
  return body.workflows;
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
