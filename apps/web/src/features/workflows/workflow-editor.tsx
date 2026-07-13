"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
} from "@xyflow/react";
import {
  validateWorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowValidationIssue,
} from "@ujima/shared";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { NODE_KIND_STYLES, workflowNodeTypes, type FlowNode } from "./nodes";
import { NodeInspector } from "./node-inspector";
import { flowToGraph, graphToFlow, inferPort } from "./graph-flow";
import { createNode } from "./node-factory";
import {
  WorkflowApiError,
  createWorkflow,
  getWorkflow,
  updateWorkflow,
  type WorkflowInput,
} from "./use-workflows";

const PALETTE_KINDS: WorkflowNodeKind[] = [
  "agent",
  "skill",
  "tool",
  "approval",
  "goal_handoff",
  "trigger",
];

function newTriggerGraph() {
  return graphToFlow(
    [{ id: "trigger", kind: "trigger", position: { x: 240, y: 40 }, config: { source: "mention" } }],
    [],
  );
}

function WorkflowEditorInner({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = workflowId === "new";
  const [channelId, setChannelId] = useState<string | null>(
    isNew ? searchParams.get("channelId") : null,
  );

  const initialFlow = useMemo(
    () => (isNew ? newTriggerGraph() : { flowNodes: [] as FlowNode[], flowEdges: [] as Edge[] }),
    [isNew],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialFlow.flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialFlow.flowEdges);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<WorkflowValidationIssue[]>([]);

  // Load an existing definition (the "new" case is seeded as initial state).
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    getWorkflow(workflowId)
      .then((def) => {
        if (cancelled) return;
        const { flowNodes, flowEdges } = graphToFlow(def.nodes, def.edges);
        setNodes(flowNodes);
        setEdges(flowEdges);
        setName(def.name);
        setDescription(def.description ?? "");
        setChannelId(def.channelId ?? null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [workflowId, isNew, setNodes, setEdges]);

  const onConnect = useCallback(
    (conn: Connection) => {
      const srcKind = nodes.find((n) => n.id === conn.source)?.data.node.kind;
      const port = inferPort(srcKind);
      const edge: Edge = {
        id: `e-${conn.source}-${conn.target}-${Date.now()}`,
        source: conn.source,
        target: conn.target,
        animated: port === "main",
        style: port === "main" ? { strokeWidth: 2 } : { strokeWidth: 1.5, strokeDasharray: "4 4" },
        data: { port },
      };
      setEdges((eds) => addEdge(edge, eds));
    },
    [nodes, setEdges],
  );

  const addNode = useCallback(
    (kind: WorkflowNodeKind) => {
      setNodes((ns) => {
        const existing = ns.map((n) => n.id);
        const offset = ns.length * 24;
        const node = createNode(kind, { x: 120 + offset, y: 160 + offset }, existing);
        const { flowNodes } = graphToFlow([node], []);
        return [...ns, ...flowNodes];
      });
    },
    [setNodes],
  );

  const selectedNode = useMemo(() => nodes.find((n) => n.selected)?.data.node ?? null, [nodes]);

  const updateSelected = useCallback(
    (next: FlowNode["data"]["node"]) => {
      setNodes((ns) => ns.map((n) => (n.id === next.id ? { ...n, data: { node: next } } : n)));
    },
    [setNodes],
  );

  const deleteSelected = useCallback(() => {
    setNodes((ns) => {
      const selected = new Set(ns.filter((n) => n.selected).map((n) => n.id));
      setEdges((eds) => eds.filter((e) => !selected.has(e.source) && !selected.has(e.target)));
      return ns.filter((n) => !n.selected);
    });
  }, [setNodes, setEdges]);

  const onSave = useCallback(async () => {
    setError(null);
    setIssues([]);
    if (!name.trim()) {
      setError("Give the workflow a name.");
      return;
    }
    const graph = flowToGraph(nodes, edges);
    const result = validateWorkflowGraph(graph);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    const input: WorkflowInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      channelId,
      nodes: graph.nodes,
      edges: graph.edges,
    };
    setSaving(true);
    try {
      const saved = isNew ? await createWorkflow(input) : await updateWorkflow(workflowId, input);
      router.push(`/workflows/${saved.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof WorkflowApiError) {
        setError(err.message);
        if (err.issues) setIssues(err.issues);
      } else {
        setError(err instanceof Error ? err.message : "Failed to save.");
      }
    } finally {
      setSaving(false);
    }
  }, [name, description, channelId, nodes, edges, isNew, workflowId, router]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => router.push("/workflows")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Back to workflows"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Untitled workflow"
          className="min-w-0 flex-1 bg-transparent text-base font-semibold text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
        <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {channelId ? "Scoped to this channel" : "All channels"}
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isNew ? "Create" : "Save"}
        </button>
      </header>

      {(error || issues.length > 0) && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error && <p className="font-medium">{error}</p>}
          {issues.map((issue, i) => (
            <p key={i}>• {issue.message}</p>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-44 shrink-0 space-y-1 overflow-y-auto border-r border-zinc-200 p-2 dark:border-zinc-800">
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Add node</p>
          {PALETTE_KINDS.map((kind) => {
            const style = NODE_KIND_STYLES[kind];
            const Icon = style.icon;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => addNode(kind)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-md ${style.iconWrap}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {style.label}
                <Plus className="ml-auto h-3.5 w-3.5 text-zinc-400" />
              </button>
            );
          })}
        </aside>

        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={workflowNodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-zinc-50 dark:bg-zinc-950"
          >
            <Background className="!bg-zinc-50 dark:!bg-zinc-950" color="#d4d4d8" gap={18} />
            <Controls className="!border !border-zinc-200 !bg-white dark:!border-zinc-700 dark:!bg-zinc-900" />
            <MiniMap pannable zoomable className="!bg-white dark:!bg-zinc-900" />
            <Panel position="bottom-center">
              <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] text-zinc-500 shadow-sm backdrop-blur dark:bg-zinc-900/80 dark:text-zinc-400">
                Drag from a node&apos;s dots to connect. Skill/tool nodes attach to an agent (dashed).
              </span>
            </Panel>
          </ReactFlow>
        </div>

        <aside className="w-80 shrink-0 border-l border-zinc-200 dark:border-zinc-800">
          <NodeInspector node={selectedNode} onChange={updateSelected} onDelete={deleteSelected} />
        </aside>
      </div>
    </div>
  );
}

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner workflowId={workflowId} />
    </ReactFlowProvider>
  );
}
