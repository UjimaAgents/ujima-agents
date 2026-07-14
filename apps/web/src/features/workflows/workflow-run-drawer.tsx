"use client";

import Link from "next/link";
import { ExternalLink, Loader2, Workflow, X } from "lucide-react";
import type { WorkflowRun } from "@ujima/shared";
import { useWorkflowRun } from "./use-workflow-run";
import { WorkflowRunControls, WorkflowRunSidePanel } from "./workflow-run-side-panel";

const RUN_STATUS_BADGE: Record<WorkflowRun["status"], string> = {
  running: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  awaiting_approval: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  paused: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

/**
 * In-channel slide-over for a workflow run — opened from the run card so the
 * operator can watch progress, view artifacts, and approve gates without leaving
 * the conversation. The full canvas view stays available via "Open full".
 */
export function WorkflowRunDrawer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  if (!runId) return null;
  return <DrawerBody runId={runId} onClose={onClose} />;
}

function DrawerBody({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { detail, loading, error, busy, act, reload } = useWorkflowRun(runId);
  const run = detail?.run;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div className="flex w-screen max-w-md transform flex-col border-l border-zinc-200 bg-white shadow-2xl transition-all duration-300 animate-in slide-in-from-right dark:border-zinc-800 dark:bg-zinc-950">
          {/* Header */}
          <div className="flex shrink-0 items-start gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-900">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Workflow className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-bold text-zinc-950 dark:text-zinc-50">
                  {run?.name ?? "Workflow run"}
                </h2>
                {run && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RUN_STATUS_BADGE[run.status]}`}>
                    {run.status.replace("_", " ")}
                  </span>
                )}
              </div>
              {run?.input && (
                <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{run.input}</p>
              )}
            </div>
            <Link
              href={`/workflows/runs/${runId}`}
              className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              title="Open full run view"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="mt-0.5 shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {run && (
            <div className="flex shrink-0 items-center justify-end gap-1.5 px-4 py-2">
              <WorkflowRunControls status={run.status} busy={busy} onAct={act} />
            </div>
          )}

          {error && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          )}

          {loading || !detail ? (
            <div className="flex flex-1 items-center justify-center text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <WorkflowRunSidePanel runId={runId} detail={detail} onReload={reload} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
