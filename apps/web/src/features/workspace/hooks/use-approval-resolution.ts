"use client";

import { useCallback, useState } from "react";
import { ApprovalRequestSchema } from "@ujima/shared/browser";
import { useWorkspaceStore } from "../workspace-store";
import { resolveWorkspaceApproval } from "../approval-resolution";
import { resolveWorkflowGate } from "../use-workflow-approvals";
import { approvalToActivity } from "../activity-events";
import { approvalToCard } from "../approval-card-data";

export type ApprovalResolution = "allow_once" | "allow_always" | "allow_family" | "reject";

/**
 * Single implementation of approval resolution for every surface (channel
 * Approvals tab, floating global indicator): per-id busy/error maps, the
 * workflow-gate vs MCP-approval branch, error extraction, and the
 * parse-and-upsert of the resolved card.
 */
export function useApprovalResolution(organizationId: string | undefined) {
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resolve = useCallback(
    async (approvalId: string, resolution: ApprovalResolution) => {
      if (!organizationId) {
        throw new Error("Missing organization context for approval resolution.");
      }
      setResolving((state) => ({ ...state, [approvalId]: true }));
      setErrors((state) => {
        const next = { ...state };
        delete next[approvalId];
        return next;
      });
      const clearResolving = () =>
        setResolving((state) => {
          const next = { ...state };
          delete next[approvalId];
          return next;
        });
      // Workflow gates resolve through the workflow transition endpoint, not
      // the MCP approval service.
      const workflowCard = useWorkspaceStore
        .getState()
        .approvals.find((a) => a.id === approvalId && a.workflowScope);
      if (workflowCard) {
        try {
          await resolveWorkflowGate(workflowCard, resolution);
          useWorkspaceStore.getState().removeApproval(approvalId);
        } catch (err) {
          setErrors((state) => ({
            ...state,
            [approvalId]: err instanceof Error ? err.message : "Unable to resolve gate.",
          }));
        } finally {
          clearResolving();
        }
        return;
      }
      try {
        const body = await resolveWorkspaceApproval({ organizationId, approvalId, resolution });
        const parsed = ApprovalRequestSchema.safeParse(body);
        if (parsed.success) {
          useWorkspaceStore.getState().upsertApproval(
            parsed.data,
            (value, state) => approvalToCard(value, { members: state.members }),
            approvalToActivity,
          );
        }
      } catch (err) {
        setErrors((state) => ({
          ...state,
          [approvalId]: err instanceof Error ? err.message : "Unable to resolve approval.",
        }));
      } finally {
        clearResolving();
      }
    },
    [organizationId],
  );

  return { resolve, resolving, errors };
}
