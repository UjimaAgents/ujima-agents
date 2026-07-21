"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkflowTransitionAction } from "@ujima/shared";
import { getWorkflowRun, transitionWorkflowRun, type WorkflowRunDetail } from "./use-workflows";

const ACTIVE_STATUSES = new Set(["running", "awaiting_approval"]);

/**
 * Loads a workflow run's detail, polls while it's active, and exposes the
 * transition action. Shared by the full-page run view and the in-channel run
 * drawer so both stay consistent.
 */
export function useWorkflowRun(runId: string) {
  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await getWorkflowRun(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run.");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    getWorkflowRun(runId)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load run."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Poll while the run is active so status/steps stay live.
  useEffect(() => {
    if (!detail || !ACTIVE_STATUSES.has(detail.run.status)) return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [detail, load]);

  const act = useCallback(
    async (action: WorkflowTransitionAction) => {
      let reason: string | undefined;
      if (action === "reject") {
        reason = window.prompt("Reason for rejection?") ?? undefined;
      }
      setBusy(true);
      try {
        await transitionWorkflowRun(runId, action, reason);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed.");
      } finally {
        setBusy(false);
      }
    },
    [runId, load],
  );

  return { detail, loading, error, busy, act, reload: load, setError };
}
