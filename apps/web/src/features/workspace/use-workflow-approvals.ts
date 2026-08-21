"use client";

import { useCallback, useEffect } from "react";
import { SocketEventNames } from "@ujima/shared/browser";
import {
  listWorkflowApprovals,
  transitionWorkflowRun,
  type WorkflowApproval,
  type WorkflowToolApproval,
} from "@/features/workflows/use-workflows";
import type { ApprovalCardData } from "./components/chat";
import { useWorkspaceStore } from "./workspace-store";
import { subscribeWorkspaceLiveEvents } from "./live-events";

/** Map a pending workflow gate into the shared approval-queue card shape. */
export function workflowApprovalToCard(wf: WorkflowApproval): ApprovalCardData {
  return {
    id: wf.id,
    runId: wf.workflowRunId,
    threadId: wf.channelId,
    requestedByMemberId: wf.requestedBy,
    title: "Approve workflow gate",
    description: wf.prompt || `Approve to continue "${wf.workflowName}".`,
    status: "pending",
    requestedBy: wf.workflowName,
    createdAt: wf.createdAt,
    approvalsNeeded: 1,
    workflowRunId: wf.workflowRunId,
    workflowScope: {
      workflowRunId: wf.workflowRunId,
      nodeId: wf.nodeId,
      workflowName: wf.workflowName,
      ...(wf.priorSummary ? { priorSummary: wf.priorSummary } : {}),
      ...(wf.priorOutputPath ? { priorOutputPath: wf.priorOutputPath } : {}),
    },
  };
}

/**
 * Map a blocking tool approval (write/MCP) into a card. No workflowScope — it's a
 * real ApprovalService approval that resolves through the normal path; the
 * workflowRunId marker just keeps it in the workflow-sourced store bucket.
 */
export function toolApprovalToCard(t: WorkflowToolApproval): ApprovalCardData {
  const base = t.resourcePath.split("/").filter(Boolean).pop() ?? t.resourcePath;
  const label =
    t.resourceType === "mcp"
      ? `run ${t.resourcePath.split(":").pop() ?? "an MCP tool"}`
      : t.resourceType === "file"
        ? `${t.action} ${base}`
        : `${t.action} ${base}`;
  return {
    id: t.id,
    runId: t.workflowRunId,
    threadId: t.channelId,
    // Prefer the stable member id; omit rather than fall back to a display name.
    ...(t.requestedByMemberId ? { requestedByMemberId: t.requestedByMemberId } : {}),
    title: `Approve: ${label}`,
    description: `${t.agentName} in "${t.workflowName}" wants to ${label}.`,
    status: "pending",
    requestedBy: t.agentName,
    createdAt: t.createdAt,
    approvalsNeeded: 1,
    workflowRunId: t.workflowRunId,
  };
}

/**
 * Resolve a workflow-gate approval via the workflow transition endpoint. The
 * queue emits a permission-style resolution; for a binary gate every "allow_*"
 * is Approve and only "reject" is Reject.
 */
export async function resolveWorkflowGate(
  card: ApprovalCardData,
  resolution: "allow_once" | "allow_always" | "allow_family" | "reject",
): Promise<void> {
  if (!card.workflowScope) return;
  await transitionWorkflowRun(
    card.workflowScope.workflowRunId,
    resolution === "reject" ? "reject" : "approve",
  );
}

/**
 * Loads pending workflow gates once, then refreshes them from the workspace
 * event stream so they share the normal approval queue.
 */
export function useWorkflowApprovalsLive(): void {
  const setWorkflowApprovals = useWorkspaceStore((state) => state.setWorkflowApprovals);
  const refresh = useCallback(async () => {
    const { approvals, toolApprovals } = await listWorkflowApprovals();
    const cards = [
      ...approvals.map(workflowApprovalToCard),
      ...toolApprovals.map(toolApprovalToCard),
    ];
    setWorkflowApprovals(cards);
  }, [setWorkflowApprovals]);

  useEffect(() => {
    void refresh();
    return subscribeWorkspaceLiveEvents(({ event }) => {
      if (
        event === SocketEventNames.workflowRunUpdated ||
        event === SocketEventNames.approvalRequested ||
        event === SocketEventNames.approvalResolved
      ) {
        void refresh();
      }
    });
  }, [refresh]);
}
