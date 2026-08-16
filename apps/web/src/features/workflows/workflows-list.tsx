"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Search, Trash2, Workflow } from "lucide-react";
import type { WorkflowDefinition } from "@ujima/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";
import { deleteWorkflow, listWorkflows } from "./use-workflows";

export function WorkflowsList() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [targetDeleteId, setTargetDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    listWorkflows()
      .then((items) => !cancelled && setWorkflows(items))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredWorkflows = useMemo(() => {
    if (!searchQuery.trim()) return workflows;
    const q = searchQuery.toLowerCase();
    return workflows.filter(
      (w) => w.name.toLowerCase().includes(q) || w.description?.toLowerCase().includes(q),
    );
  }, [workflows, searchQuery]);

  async function confirmDelete() {
    if (!targetDeleteId) return;
    const id = targetDeleteId;
    setTargetDeleteId(null);
    setDeletingId(id);
    try {
      await deleteWorkflow(id);
      setWorkflows((ws) => ws.filter((w) => w.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Workflows</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Automate multi-step agent pipelines with triggers, approvals, and handoffs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/workflows/runs"
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Runs
          </Link>
          <Link
            href="/workflows/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
          >
            <Plus className="h-4 w-4" />
            New workflow
          </Link>
        </div>
      </div>

      {workflows.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workflows by name or description…"
            className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 py-2 text-sm text-zinc-900 outline-none transition focus:border-violet-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : workflows.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <EmptyState
            icon={Workflow}
            title="No workflows yet"
            description="Create a workflow to automate multi-step tasks across your agents."
          />
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No workflows match &quot;{searchQuery}&quot;.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredWorkflows.map((wf) => (
            <div
              key={wf.id}
              className="group relative rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-violet-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-500/40"
            >
              <Link href={`/workflows/${wf.id}`} className="block">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                    <Workflow className="h-4 w-4" />
                  </span>
                  <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{wf.name}</h2>
                </div>
                {wf.description && (
                  <p className="mt-2 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{wf.description}</p>
                )}
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
                  {wf.nodes.length} node{wf.nodes.length === 1 ? "" : "s"}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => setTargetDeleteId(wf.id)}
                disabled={deletingId === wf.id}
                className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-zinc-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-500/10"
                aria-label="Delete workflow"
              >
                {deletingId === wf.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(targetDeleteId)}
        onClose={() => setTargetDeleteId(null)}
        onConfirm={confirmDelete}
        title="Delete Workflow"
        description="Are you sure you want to delete this workflow? This action cannot be undone."
        confirmLabel="Delete Workflow"
        cancelLabel="Cancel"
        variant="danger"
      />
    </div>
  );
}
