"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Background, Controls, MiniMap, ReactFlow, type Edge } from "@xyflow/react";
import {
  WorkflowGraphSchema,
  type WorkflowNodeRun,
  type WorkflowNodeRunStatus,
  type WorkflowRun,
  type WorkflowTransitionAction,
} from "@ujima/shared";
import { ArrowLeft, Loader2 } from "lucide-react";
import { NODE_STATUS_STYLES, workflowNodeTypes, type FlowNode } from "./nodes";
import { graphToFlow } from "./graph-flow";
import { getWorkflowRun, transitionWorkflowRun, type WorkflowRunDetail } from "./use-workflows";

const RUN_STATUS_BADGE: Record<WorkflowRun["status"], string> = {
  running: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  awaiting_approval: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  paused: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

const ACTIVE_STATUSES = new Set(["running", "awaiting_approval"]);

function latestByNode(nodeRuns: WorkflowNodeRun[]): Map<string, WorkflowNodeRun> {
  const map = new Map<string, WorkflowNodeRun>();
  for (const nr of nodeRuns) {
    const prev = map.get(nr.nodeId);
    if (!prev || nr.attempt >= prev.attempt) map.set(nr.nodeId, nr);
  }
  return map;
}

export function WorkflowRunView({ runId }: { runId: string }) {
  const router = useRouter();
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

  // Poll while the run is active.
  useEffect(() => {
    if (!detail || !ACTIVE_STATUSES.has(detail.run.status)) return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [detail, load]);

  const statusByNode = useMemo(
    () => (detail ? latestByNode(detail.nodeRuns) : new Map<string, WorkflowNodeRun>()),
    [detail],
  );

  const { nodes, edges } = useMemo(() => {
    if (!detail) return { nodes: [] as FlowNode[], edges: [] as Edge[] };
    const graph = WorkflowGraphSchema.parse(JSON.parse(detail.run.graphSnapshot));
    const { flowNodes, flowEdges } = graphToFlow(graph.nodes, graph.edges);
    const withStatus = flowNodes.map((n) => ({
      ...n,
      data: { ...n.data, status: statusByNode.get(n.id)?.status as WorkflowNodeRunStatus | undefined },
    }));
    return { nodes: withStatus, edges: flowEdges };
  }, [detail, statusByNode]);

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

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!detail) {
    return <div className="p-6 text-sm text-red-600">{error ?? "Run not found."}</div>;
  }

  const { run } = detail;
  const controls: WorkflowTransitionAction[] =
    run.status === "awaiting_approval"
      ? ["approve", "reject"]
      : run.status === "paused"
        ? ["retry", "skip", "abort"]
        : [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => router.push("/workflows/runs")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Back to runs"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">{run.name}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RUN_STATUS_BADGE[run.status]}`}>
              {run.status.replace("_", " ")}
            </span>
          </div>
          {run.input && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{run.input}</p>}
        </div>
        {controls.length > 0 && (
          <div className="flex items-center gap-1.5">
            {controls.map((action) => (
              <button
                key={action}
                type="button"
                disabled={busy}
                onClick={() => act(action)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                  action === "approve"
                    ? "bg-emerald-600 text-white hover:bg-emerald-500"
                    : action === "reject" || action === "abort"
                      ? "border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:hover:bg-red-500/10"
                      : "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {action}
              </button>
            ))}
          </div>
        )}
      </header>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={workflowNodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-zinc-50 dark:bg-zinc-950"
          >
            <Background color="#d4d4d8" gap={18} />
            <Controls showInteractive={false} className="!border !border-zinc-200 !bg-white dark:!border-zinc-700 dark:!bg-zinc-900" />
            <MiniMap pannable className="!bg-white dark:!bg-zinc-900" />
          </ReactFlow>
        </div>

        <aside className="w-80 shrink-0 space-y-2 overflow-y-auto border-l border-zinc-200 p-3 dark:border-zinc-800">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Steps</p>
          {[...statusByNode.values()]
            .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))
            .map((nr) => {
              const s = NODE_STATUS_STYLES[nr.status];
              return (
                <div key={nr.id} className="rounded-lg border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">{nr.nodeId}</span>
                    <span className="ml-auto text-[10px] uppercase text-zinc-400">{s.label}</span>
                  </div>
                  {nr.summary && <p className="mt-1 text-zinc-600 dark:text-zinc-400">{nr.summary}</p>}
                  {nr.outputPath && <p className="mt-1 truncate font-mono text-[10px] text-zinc-400">{nr.outputPath}</p>}
                  {nr.failureReason && <p className="mt-1 text-red-500">{nr.failureReason}</p>}
                </div>
              );
            })}
        </aside>
      </div>
    </div>
  );
}
