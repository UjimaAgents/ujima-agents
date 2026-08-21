"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SocketEventNames, WorkflowRunUpdatedEventSchema, type WorkflowTransitionAction } from "@ujima/shared/browser";
import { getWorkflowRun, transitionWorkflowRun, type WorkflowRunDetail } from "./use-workflows";
import { subscribeWorkspaceLiveEvents } from "@/features/workspace/live-events";

/**
 * Loads a workflow run's detail and refreshes it from the workspace's canonical
 * workflow snapshot event.
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

  useEffect(() => {
    return subscribeWorkspaceLiveEvents(({ event, payload }) => {
      if (event !== SocketEventNames.workflowRunUpdated) return;
      const parsed = WorkflowRunUpdatedEventSchema.safeParse(payload);
      if (parsed.success && parsed.data.run.id === runId) void load();
    });
  }, [load, runId]);

  const act = useCallback(
    async (action: WorkflowTransitionAction, rejectionReason?: string) => {
      let reason: string | undefined = rejectionReason;
      if (action === "reject" && rejectionReason === undefined) {
        const input = window.prompt("Reason for rejection?");
        if (input === null) return;
        reason = input || undefined;
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
