"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Loader2 } from "lucide-react";
import type { WorkflowRun } from "@ujima/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { listWorkflowRuns } from "./use-workflows";

const STATUS_BADGE: Record<WorkflowRun["status"], string> = {
  running: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  awaiting_approval: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  paused: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

export function WorkflowRunsList() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listWorkflowRuns()
      .then((items) => !cancelled && setRuns(items))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Workflow runs</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Every SOP execution — live status, approvals, and step output.
          </p>
        </div>
        <Link
          href="/workflows"
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Definitions
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <EmptyState
            icon={Activity}
            title="No runs yet"
            description="Trigger one with @workflow <name> <input> in a channel, or the workflow.run tool."
          />
        </div>
      ) : (
        <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/workflows/runs/${run.id}`}
              className="flex items-center gap-3 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{run.name}</p>
                {run.input && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{run.input}</p>}
              </div>
              <span className="text-[11px] text-zinc-400">{new Date(run.updatedAt).toLocaleString()}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[run.status]}`}>
                {run.status.replace("_", " ")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
