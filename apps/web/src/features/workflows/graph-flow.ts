"use client";

import type { Edge } from "@xyflow/react";
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
  if (sourceKind === "skill") return "ai_skill";
  if (sourceKind === "tool") return "ai_tool";
  return "main";
}

function edgeStyle(port: WorkflowPort): Edge["style"] {
  if (port === "main") return { strokeWidth: 2 };
  return { strokeWidth: 1.5, strokeDasharray: "4 4" };
}

export function graphToFlow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): { flowNodes: FlowNode[]; flowEdges: Edge[] } {
  const flowNodes: FlowNode[] = nodes.map((node) => ({
    id: node.id,
    type: "workflow",
    position: node.position,
    data: { node },
  }));
  const flowEdges: Edge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: edge.targetPort === "main",
    style: edgeStyle(edge.targetPort),
    data: { port: edge.targetPort },
  }));
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
