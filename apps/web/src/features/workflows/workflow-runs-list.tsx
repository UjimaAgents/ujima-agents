"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Clock, Loader2, Search } from "lucide-react";
import type { WorkflowRun, WorkflowRunStatus } from "@ujima/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { listWorkflowRuns } from "./use-workflows";

const STATUS_BADGE: Record<WorkflowRun["status"], string> = {
  running: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  awaiting_approval: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  paused: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

function formatRunDuration(startedAt?: number | string, completedAt?: number | string): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

type FilterStatus = "all" | WorkflowRunStatus;

export function WorkflowRunsList() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");

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

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (statusFilter !== "all" && run.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return run.name.toLowerCase().includes(q) || run.input?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [runs, searchQuery, statusFilter]);

  const filterTabs: { id: FilterStatus; label: string }[] = [
    { id: "all", label: "All" },
    { id: "running", label: "Running" },
    { id: "awaiting_approval", label: "Awaiting approval" },
    { id: "completed", label: "Completed" },
    { id: "failed", label: "Failed" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Workflow runs</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Track execution status, approvals, and step output for every run.
          </p>
        </div>
        <Link
          href="/workflows"
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Workflows
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search runs by workflow name or input…"
            className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 py-2 text-sm text-zinc-900 outline-none transition focus:border-violet-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        <div className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2 sm:border-b-0 sm:pb-0 dark:border-zinc-800">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                statusFilter === tab.id
                  ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
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
            description="Trigger a workflow from a channel or via the API to see runs here."
          />
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No runs match your search or filter.
        </div>
      ) : (
        <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {filteredRuns.map((run) => {
            const duration = formatRunDuration(run.createdAt, run.updatedAt);
            return (
              <Link
                key={run.id}
                href={`/workflows/runs/${run.id}`}
                className="flex items-center gap-3 bg-white px-4 py-3 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{run.name}</p>
                  {run.input && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{run.input}</p>}
                </div>
                {duration && (
                  <span className="flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <Clock className="h-3 w-3" />
                    {duration}
                  </span>
                )}
                <span className="text-xs text-zinc-400">{new Date(run.updatedAt).toLocaleTimeString()}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[run.status]}`}>
                  {run.status.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
