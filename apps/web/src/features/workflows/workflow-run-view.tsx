"use client";

import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Background, Controls, MiniMap, ReactFlow, type Edge } from "@xyflow/react";
import {
  WorkflowGraphSchema,
  type WorkflowNodeRun,
  type WorkflowNodeRunStatus,
  type WorkflowRun,
} from "@ujima/shared";
import { ArrowLeft, Loader2 } from "lucide-react";
import { workflowNodeTypes, type FlowNode } from "./nodes";
import { graphToFlow } from "./graph-flow";
import { useWorkflowRun } from "./use-workflow-run";
import { WorkflowRunControls, WorkflowRunSidePanel } from "./workflow-run-side-panel";

const RUN_STATUS_BADGE: Record<WorkflowRun["status"], string> = {
  running: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  awaiting_approval: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  paused: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

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
  const { detail, loading, error, busy, act, reload } = useWorkflowRun(runId);

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

  if (loading && !detail) {
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
        <WorkflowRunControls status={run.status} busy={busy} onAct={act} />
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
            fitViewOptions={{ maxZoom: 0.9, padding: 0.35 }}
            minZoom={0.2}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            className="bg-zinc-50 dark:bg-zinc-950"
          >
            <Background color="#d4d4d8" gap={18} />
            <Controls showInteractive={false} className="!border !border-zinc-200 !bg-white dark:!border-zinc-700 dark:!bg-zinc-900" />
            <MiniMap pannable className="!bg-white dark:!bg-zinc-900" />
          </ReactFlow>
        </div>

        <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-zinc-200 dark:border-zinc-800">
          <WorkflowRunSidePanel runId={runId} detail={detail} onReload={reload} />
        </aside>
      </div>
    </div>
  );
}
