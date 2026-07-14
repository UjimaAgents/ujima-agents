"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Workflow, X } from "lucide-react";
import type { WorkflowRun } from "@ujima/shared";
import { listWorkflowRuns } from "./use-workflows";

const POLL_MS = 8000;

/**
 * Floating, workspace-wide indicator that a workflow run is in progress. Mirrors
 * the pending-approval pill (which covers gates) but for the `running` state, so
 * an active run stays visible while you scroll or keep chatting. Expands to a
 * short list linking into each run.
 */
export function WorkflowRunsIndicator(): React.ReactElement | null {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let lastSig = "";
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const active = await listWorkflowRuns("running");
        if (cancelled) return;
        const sig = active.map((r) => r.id).sort().join("|");
        if (sig === lastSig) return;
        lastSig = sig;
        setRuns(active);
      } catch {
        // transient — keep last
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (runs.length === 0) return null;
  const label = runs.length === 1 ? "1 workflow running" : `${runs.length} workflows running`;

  return (
    <div className="fixed bottom-[4.75rem] right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-900">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Running workflows</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto p-2">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/workflows/runs/${run.id}`}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">{run.name}</span>
                <span className="shrink-0 text-[11px] font-medium text-violet-600 dark:text-violet-300">open →</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 shadow-lg transition hover:bg-blue-50 dark:border-blue-500/30 dark:bg-zinc-950 dark:text-blue-300 dark:hover:bg-blue-500/10"
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          <Workflow className="absolute h-2.5 w-2.5" />
        </span>
        {label}
      </button>
    </div>
  );
}
