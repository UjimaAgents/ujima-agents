"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Plus, Settings2, Workflow } from "lucide-react";
import type { WorkflowDefinition } from "@ujima/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { listWorkflows, runWorkflow } from "./use-workflows";

interface Props {
  channelId: string;
  threadId: string;
}

export function ChannelWorkflowsTab({ channelId, threadId }: Props) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listWorkflows(channelId)
      .then((items) => !cancelled && setWorkflows(items))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const run = useCallback(
    async (wf: WorkflowDefinition) => {
      const input = window.prompt(`Run "${wf.name}" — what's the input?`, "");
      if (input === null) return;
      setRunningId(wf.id);
      setError(null);
      try {
        const { workflow_run_id } = await runWorkflow(wf.id, input, channelId, threadId);
        router.push(`/workflows/runs/${workflow_run_id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start workflow.");
      } finally {
        setRunningId(null);
      }
    },
    [channelId, threadId, router],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Workflows</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            SOPs you can run in this channel. Runs open in the workflow run view.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/workflows/new?channelId=${encodeURIComponent(channelId)}`)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
        >
          <Plus className="h-3.5 w-3.5" />
          New for this channel
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : workflows.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <EmptyState
            icon={Workflow}
            title="No workflows here yet"
            description="Create one scoped to this channel, or an org-wide workflow will show up here too."
          />
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                <Workflow className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{wf.name}</p>
                  <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {wf.channelId ? "this channel" : "org-wide"}
                  </span>
                </div>
                {wf.description && (
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{wf.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => router.push(`/workflows/${wf.id}`)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                aria-label="Edit workflow"
                title="Edit"
              >
                <Settings2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => run(wf)}
                disabled={runningId === wf.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-violet-300 hover:text-violet-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-violet-500/40"
              >
                {runningId === wf.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Run
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
