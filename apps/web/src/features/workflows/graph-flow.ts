"use client";

import type { Edge } from "@xyflow/react";
import { normalizeWorkflowGraph, workflowPortForNodeKind } from "@ujima/shared";
import type {
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowPort,
} from "@ujima/shared";
import type { FlowNode } from "./nodes";

/**
 * The edge port is inferred from the *source* node's kind: a skill node always
 * attaches via `ai_skill`, a tool via `ai_tool`, everything else is `main`.
 * This lets the canvas use a single handle per side while still producing the
 * correct typed ports for the backend.
 */
export function inferPort(sourceKind: WorkflowNodeKind | undefined): WorkflowPort {
  return workflowPortForNodeKind(sourceKind);
}

function edgeStyle(port: WorkflowPort): Edge["style"] {
  if (port === "main") return { strokeWidth: 2 };
  return { strokeWidth: 1.5, strokeDasharray: "4 4" };
}

export function graphToFlow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): { flowNodes: FlowNode[]; flowEdges: Edge[] } {
  const graph = normalizeWorkflowGraph({ nodes, edges });
  const flowNodes: FlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: "workflow",
    position: node.position,
    data: { node },
  }));
  const flowEdges: Edge[] = graph.edges.map((edge) => {
    const port = edge.targetPort;
    const isMain = port === "main";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: isMain ? "main-out" : "cap-out",
      targetHandle: isMain ? "main-in" : "cap-in",
      animated: isMain,
      style: edgeStyle(port),
      data: { port },
    };
  });
  return { flowNodes, flowEdges };
}

export function flowToGraph(
  flowNodes: FlowNode[],
  flowEdges: Edge[],
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const kindById = new Map(flowNodes.map((n) => [n.id, n.data.node.kind] as const));
  const nodes: WorkflowNode[] = flowNodes.map((fn) => ({
    ...fn.data.node,
    position: { x: Math.round(fn.position.x), y: Math.round(fn.position.y) },
  }));
  const edges: WorkflowEdge[] = flowEdges.map((fe) => {
    const port = inferPort(kindById.get(fe.source));
    return {
      id: fe.id,
      source: fe.source,
      sourcePort: port,
      target: fe.target,
      targetPort: port,
    };
  });
  return { nodes, edges };
}
