"use client";

import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { Background, Controls, ReactFlow, type Edge } from "@xyflow/react";
import { WorkflowGraphSchema, type WorkflowNodeRunStatus } from "@ujima/shared";
import { workflowNodeTypes, type FlowNode } from "./nodes";
import { graphToFlow } from "./graph-flow";
import type { WorkflowRunDetail } from "./use-workflows";

/** Read-only run graph with each node colored by its live status (running node
 *  pulses via the node component's status ring). */
export function WorkflowRunCanvas({ detail }: { detail: WorkflowRunDetail }) {
  const statusByNode = useMemo(() => {
    const latest = new Map<string, { attempt: number; status: WorkflowNodeRunStatus }>();
    for (const nr of detail.nodeRuns) {
      const prev = latest.get(nr.nodeId);
      if (!prev || nr.attempt >= prev.attempt) {
        latest.set(nr.nodeId, { attempt: nr.attempt, status: nr.status as WorkflowNodeRunStatus });
      }
    }
    return latest;
  }, [detail]);

  const { nodes, edges } = useMemo(() => {
    const graph = WorkflowGraphSchema.parse(JSON.parse(detail.run.graphSnapshot));
    const { flowNodes, flowEdges } = graphToFlow(graph.nodes, graph.edges);
    return {
      nodes: flowNodes.map((n) => ({ ...n, data: { ...n.data, status: statusByNode.get(n.id)?.status } })) as FlowNode[],
      edges: flowEdges as Edge[],
    };
  }, [detail, statusByNode]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={workflowNodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      fitView
      fitViewOptions={{ maxZoom: 0.9, padding: 0.3 }}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      className="bg-zinc-50 dark:bg-zinc-950"
    >
      <Background color="#d4d4d8" gap={16} />
      <Controls
        showInteractive={false}
        className="!border !border-zinc-200 !bg-white dark:!border-zinc-700 dark:!bg-zinc-900"
      />
    </ReactFlow>
  );
}
