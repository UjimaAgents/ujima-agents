"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowTransitionAction } from "@ujima/shared";
import { usePolling } from "@/hooks/use-polling";
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
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const next = await getWorkflowRun(runId);
      if (sequence !== loadSequence.current) return;
      setDetail(next);
      setError(null);
    } catch (err) {
      if (sequence !== loadSequence.current) return;
      setError(err instanceof Error ? err.message : "Failed to load run.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDetail(null);
      setError(null);
      setLoading(true);
      void load();
    });
    return () => {
      cancelled = true;
    };
  }, [runId, load]);

  // Poll while the run is active so status/steps stay live. The hook prevents
  // overlap and pauses hidden tabs.
  usePolling(load, {
    intervalMs: 2500,
    enabled: Boolean(detail && ACTIVE_STATUSES.has(detail.run.status)),
    immediate: false,
  });

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
