"use client";

import { useEffect } from "react";
import {
  listWorkflowApprovals,
  transitionWorkflowRun,
  type WorkflowApproval,
  type WorkflowToolApproval,
} from "@/features/workflows/use-workflows";
import type { ApprovalCardData } from "./components/chat";
import { useWorkspaceStore } from "./workspace-store";

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
    requestedByMemberId: t.agentName,
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

const WORKFLOW_APPROVALS_POLL_MS = 15000;

/**
 * Polls pending workflow gates and feeds them into the approval store, so they
 * surface in the same "Approval N of M" queue + floating pending pill as MCP
 * approvals. Mounted once at the workspace shell.
 *
 * Kept deliberately light: it pauses while the tab is hidden and only writes to
 * the store when the pending set actually changed (a signature compare), so a
 * steady state costs one cheap request per interval and zero re-renders.
 */
export function useWorkflowApprovalsPoll(): void {
  const setWorkflowApprovals = useWorkspaceStore((state) => state.setWorkflowApprovals);
  useEffect(() => {
    let cancelled = false;
    let lastSignature = "";
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const { approvals, toolApprovals } = await listWorkflowApprovals();
        if (cancelled) return;
        const cards = [
          ...approvals.map(workflowApprovalToCard),
          ...toolApprovals.map(toolApprovalToCard),
        ];
        const signature = cards
          .map((c) => c.id)
          .sort()
          .join("|");
        if (signature === lastSignature) return; // unchanged — skip the store write
        lastSignature = signature;
        setWorkflowApprovals(cards);
      } catch {
        // Transient — keep the last known set until the next tick.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), WORKFLOW_APPROVALS_POLL_MS);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [setWorkflowApprovals]);
}
