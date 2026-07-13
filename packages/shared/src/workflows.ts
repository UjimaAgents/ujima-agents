import {z} from "zod";
import {IdSchema, TimestampSchema} from "./org-schemas.js";

// ---------------------------------------------------------------------------
// Ujima SOP Workflows — the n8n-inspired graph model.
//
// A workflow is a directed graph. AGENT nodes are the main-flow SOP steps
// (each produces a document/envelope and hands it to the next). SKILL and
// TOOL nodes are *sub-nodes* attached to an agent via typed ports
// (`ai_skill` / `ai_tool`) — capabilities the agent may use at runtime, not
// pipeline stages. TRIGGER is the entry node; GOAL_HANDOFF is a terminal node
// that hands off to the goal system.
//
// The graph JSON is the persisted source of truth (authored in the visual
// editor). This module owns the schemas + a pure structural validator; the
// orchestrator owns execution and token substitution.
// ---------------------------------------------------------------------------

export const WorkflowNodeKindSchema = z.enum([
  "trigger",
  "agent",
  "approval",
  "goal_handoff",
  "skill",
  "tool",
]);
export type WorkflowNodeKind = z.infer<typeof WorkflowNodeKindSchema>;

/** Kinds that live on the `main` execution flow (carry the envelope). */
export const MAIN_FLOW_KINDS: readonly WorkflowNodeKind[] = [
  "trigger",
  "agent",
  "approval",
  "goal_handoff",
];
/** Kinds that attach to an agent as a capability sub-node. */
export const SUBNODE_KINDS: readonly WorkflowNodeKind[] = ["skill", "tool"];

// Typed ports. `main` carries the document/envelope down the SOP. `ai_skill`
// and `ai_tool` attach a capability sub-node to an agent. v2-reserved:
// `ai_model`, `ai_memory`.
export const WorkflowPortSchema = z.enum(["main", "ai_skill", "ai_tool"]);
export type WorkflowPort = z.infer<typeof WorkflowPortSchema>;

export const WorkflowPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type WorkflowPosition = z.infer<typeof WorkflowPositionSchema>;

// --- Per-kind node config -------------------------------------------------

export const TriggerNodeConfigSchema = z.object({
  source: z.enum(["manual", "mention", "tool"]).default("manual"),
});

export const AgentNodeConfigSchema = z.object({
  agentId: IdSchema,
  prompt: z.string().default(""),
  // Where the agent should write its document. May contain templating tokens
  // (e.g. `docs/{{workflow_run_id}}/brd.md`). Falls back to an engine default.
  outputPath: z.string().optional(),
  requiresApproval: z.boolean().default(false),
});

export const SkillNodeConfigSchema = z.object({
  skillName: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const ToolNodeConfigSchema = z.object({
  toolId: z.string().min(1),
});

export const ApprovalNodeConfigSchema = z.object({
  prompt: z.string().optional(),
  /**
   * When set, a designated agent reviews the upstream output and resolves the
   * gate via `workflow.transition` (approve/reject) instead of a human.
   */
  approverAgentId: IdSchema.optional(),
});

export const GoalHandoffNodeConfigSchema = z.object({
  titleTemplate: z.string().default("{{input}}"),
  // `json` reads the tasks array from the upstream node's structured json
  // channel; `template` renders `tasksTemplate` (a JSON string of tasks).
  tasksFrom: z.enum(["json", "template"]).default("json"),
  tasksTemplate: z.string().optional(),
});

const baseNodeShape = {
  id: IdSchema,
  label: z.string().optional(),
  position: WorkflowPositionSchema.default({x: 0, y: 0}),
};

export const WorkflowNodeSchema = z.discriminatedUnion("kind", [
  z.object({
    ...baseNodeShape,
    kind: z.literal("trigger"),
    config: TriggerNodeConfigSchema.default({source: "manual"}),
  }),
  z.object({
    ...baseNodeShape,
    kind: z.literal("agent"),
    config: AgentNodeConfigSchema,
  }),
  z.object({
    ...baseNodeShape,
    kind: z.literal("approval"),
    config: ApprovalNodeConfigSchema.default({}),
  }),
  z.object({
    ...baseNodeShape,
    kind: z.literal("goal_handoff"),
    config: GoalHandoffNodeConfigSchema.default({
      titleTemplate: "{{input}}",
      tasksFrom: "json",
    }),
  }),
  z.object({
    ...baseNodeShape,
    kind: z.literal("skill"),
    config: SkillNodeConfigSchema,
  }),
  z.object({
    ...baseNodeShape,
    kind: z.literal("tool"),
    config: ToolNodeConfigSchema,
  }),
]);
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: IdSchema,
  source: IdSchema,
  sourcePort: WorkflowPortSchema.default("main"),
  target: IdSchema,
  targetPort: WorkflowPortSchema.default("main"),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

/** The pure graph (nodes + edges) — what the engine snapshots at run start. */
export const WorkflowGraphSchema = z.object({
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

/** A stored, named workflow definition (graph + metadata). */
export const WorkflowDefinitionSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  /** When set, the workflow is scoped to this channel; null/absent = org-wide. */
  channelId: IdSchema.nullable().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  version: z.number().int().default(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// --- The NodeOutput envelope (what one node hands to the next) -------------

export const NodeOutputArtifactSchema = z.object({
  path: z.string(),
  kind: z.string(),
});

export const NodeOutputSchema = z.object({
  summary: z.string().default(""),
  output_file: z.string().optional(),
  json: z.unknown().optional(),
  artifacts: z.array(NodeOutputArtifactSchema).optional(),
});
export type NodeOutput = z.infer<typeof NodeOutputSchema>;

// --- Run state ------------------------------------------------------------

export const WorkflowRunStatusSchema = z.enum([
  "running",
  "awaiting_approval",
  "paused",
  "completed",
  "failed",
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export const WorkflowNodeRunStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "skipped",
]);
export type WorkflowNodeRunStatus = z.infer<typeof WorkflowNodeRunStatusSchema>;

export const WorkflowRunSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  definitionId: IdSchema.nullable().optional(),
  name: z.string().min(1),
  graphSnapshot: z.string(),
  graphSha256: z.string(),
  input: z.string().nullable().optional(),
  status: WorkflowRunStatusSchema,
  initiatedBy: IdSchema,
  channelId: IdSchema,
  threadId: IdSchema,
  lastTransitionToken: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const WorkflowNodeRunSchema = z.object({
  id: IdSchema,
  workflowRunId: IdSchema,
  nodeId: z.string().min(1),
  attempt: z.number().int(),
  kind: WorkflowNodeKindSchema,
  agentId: IdSchema.nullable().optional(),
  childRunId: IdSchema.nullable().optional(),
  outputPath: z.string().nullable().optional(),
  outputSha256: z.string().nullable().optional(),
  outputSizeBytes: z.number().int().nullable().optional(),
  outputJson: z.unknown().optional(),
  summary: z.string().nullable().optional(),
  approvalRequestId: IdSchema.nullable().optional(),
  status: WorkflowNodeRunStatusSchema,
  failureReason: z.string().nullable().optional(),
  startedAt: TimestampSchema.nullable().optional(),
  completedAt: TimestampSchema.nullable().optional(),
});
export type WorkflowNodeRun = z.infer<typeof WorkflowNodeRunSchema>;

export const WorkflowTransitionActionSchema = z.enum([
  "retry",
  "skip",
  "abort",
  "approve",
  "reject",
]);
export type WorkflowTransitionAction = z.infer<
  typeof WorkflowTransitionActionSchema
>;

// ---------------------------------------------------------------------------
// Templating tokens
//
// Resolved by the engine when building an agent node's prompt. Allowed forms:
//   {{input}}                  the workflow's trigger input
//   {{workflow_run_id}}        the run id
//   {{node.output}}            THIS node's designated output path
//   {{nodes.<id>.output}}      an upstream node's output file path
//   {{nodes.<id>.summary}}     an upstream node's summary
//   {{nodes.<id>.json}}        an upstream node's structured json
// ---------------------------------------------------------------------------

export const WORKFLOW_TOKEN_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;

export type WorkflowToken =
  | {kind: "input"}
  | {kind: "workflow_run_id"}
  | {kind: "self_output"}
  | {kind: "node"; nodeId: string; field: "output" | "summary" | "json"};

/** Parse a single token expression (the text inside `{{ }}`). */
export function parseWorkflowToken(expr: string): WorkflowToken | null {
  const trimmed = expr.trim();
  if (trimmed === "input") return {kind: "input"};
  if (trimmed === "workflow_run_id") return {kind: "workflow_run_id"};
  if (trimmed === "node.output") return {kind: "self_output"};
  const m = /^nodes\.([A-Za-z0-9_-]+)\.(output|summary|json)$/.exec(trimmed);
  const nodeId = m?.[1];
  const field = m?.[2];
  if (nodeId && field) {
    return {
      kind: "node",
      nodeId,
      field: field as "output" | "summary" | "json",
    };
  }
  return null;
}

/** Extract every `{{ ... }}` token occurrence from a string. */
export function extractWorkflowTokens(
  text: string,
): {raw: string; expr: string; token: WorkflowToken | null}[] {
  const out: {raw: string; expr: string; token: WorkflowToken | null}[] = [];
  for (const match of text.matchAll(WORKFLOW_TOKEN_PATTERN)) {
    const raw = match[0] ?? "";
    const expr = match[1] ?? "";
    out.push({raw, expr, token: parseWorkflowToken(expr)});
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export interface WorkflowValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowValidationResult {
  ok: boolean;
  issues: WorkflowValidationIssue[];
}

/**
 * Optional resolver context. When provided, the validator also rejects
 * references to unknown agents / skills / tools. Kept optional so the
 * structural validation runs without any DB access (e.g. in the editor).
 */
export interface WorkflowValidationContext {
  agentIds?: Set<string>;
  skillNames?: Set<string>;
  toolIds?: Set<string>;
}

function isUnsafeWorkspacePath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return true; // absolute
  const segments = p.split(/[\\/]/);
  return segments.some((s) => s === "..");
}

/**
 * Pure structural validation of a workflow graph. Returns all issues found
 * (does not throw). Mirrors the "validator rejects" list from the design.
 */
export function validateWorkflowGraph(
  graph: WorkflowGraph,
  ctx: WorkflowValidationContext = {},
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const {nodes, edges} = graph;

  // 1. Duplicate node ids
  const seen = new Set<string>();
  const byId = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      issues.push({
        code: "duplicate_node_id",
        message: `Duplicate node id "${node.id}".`,
        nodeId: node.id,
      });
    }
    seen.add(node.id);
    byId.set(node.id, node);
  }

  // 2. Exactly one trigger (unambiguous entry)
  const triggers = nodes.filter((n) => n.kind === "trigger");
  if (triggers.length === 0) {
    issues.push({
      code: "missing_trigger",
      message: "Workflow has no trigger node.",
    });
  } else if (triggers.length > 1) {
    issues.push({
      code: "multiple_triggers",
      message: `Workflow has ${triggers.length} trigger nodes; exactly one is allowed.`,
    });
  }

  // 3/4. Edge endpoint existence + port/kind rules
  for (const edge of edges) {
    const src = byId.get(edge.source);
    const dst = byId.get(edge.target);
    if (!src) {
      issues.push({
        code: "edge_unknown_source",
        message: `Edge references unknown source node "${edge.source}".`,
        edgeId: edge.id,
      });
    }
    if (!dst) {
      issues.push({
        code: "edge_unknown_target",
        message: `Edge references unknown target node "${edge.target}".`,
        edgeId: edge.id,
      });
    }
    if (!src || !dst) continue;

    const port = edge.targetPort;
    if (port === "ai_skill" || port === "ai_tool") {
      const wantSource = port === "ai_skill" ? "skill" : "tool";
      if (dst.kind !== "agent") {
        issues.push({
          code: "subnode_target_not_agent",
          message: `A ${port} edge must attach to an agent node, but "${edge.target}" is a ${dst.kind}.`,
          edgeId: edge.id,
        });
      }
      if (src.kind !== wantSource) {
        issues.push({
          code: "subnode_source_mismatch",
          message: `A ${port} edge must originate from a ${wantSource} node, but "${edge.source}" is a ${src.kind}.`,
          edgeId: edge.id,
        });
      }
    } else {
      // main-flow edge — both endpoints must be main-flow kinds
      if (!MAIN_FLOW_KINDS.includes(src.kind)) {
        issues.push({
          code: "subnode_on_main_flow",
          message: `Node "${edge.source}" (${src.kind}) cannot be on the main flow.`,
          edgeId: edge.id,
        });
      }
      if (!MAIN_FLOW_KINDS.includes(dst.kind)) {
        issues.push({
          code: "subnode_on_main_flow",
          message: `Node "${edge.target}" (${dst.kind}) cannot be on the main flow.`,
          edgeId: edge.id,
        });
      }
    }
  }

  // 5. Cycle detection in the main subgraph
  const mainAdj = new Map<string, string[]>();
  for (const node of nodes) mainAdj.set(node.id, []);
  for (const edge of edges) {
    if (edge.targetPort !== "main") continue;
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    mainAdj.get(edge.source)!.push(edge.target);
  }
  if (hasCycle(mainAdj)) {
    issues.push({
      code: "main_flow_cycle",
      message: "The main flow contains a cycle (loops are not supported in v1).",
    });
  }

  // Precompute main-flow ancestors for token upstream checks.
  const ancestors = computeAncestors(mainAdj);

  // 6/7/8. Per-node checks: unknown refs + token references
  for (const node of nodes) {
    if (node.kind === "agent") {
      if (ctx.agentIds && !ctx.agentIds.has(node.config.agentId)) {
        issues.push({
          code: "unknown_agent",
          message: `Agent node "${node.id}" references unknown agent "${node.config.agentId}".`,
          nodeId: node.id,
        });
      }
      if (node.config.outputPath && isUnsafeWorkspacePath(node.config.outputPath)) {
        issues.push({
          code: "output_path_escape",
          message: `Agent node "${node.id}" output path escapes the workspace.`,
          nodeId: node.id,
        });
      }
      checkTokens(node.config.prompt, node, ancestors, byId, issues);
      if (node.config.outputPath) {
        checkTokens(node.config.outputPath, node, ancestors, byId, issues);
      }
    } else if (node.kind === "skill") {
      if (ctx.skillNames && !ctx.skillNames.has(node.config.skillName)) {
        issues.push({
          code: "unknown_skill",
          message: `Skill node "${node.id}" references unknown skill "${node.config.skillName}".`,
          nodeId: node.id,
        });
      }
    } else if (node.kind === "tool") {
      if (ctx.toolIds && !ctx.toolIds.has(node.config.toolId)) {
        issues.push({
          code: "unknown_tool",
          message: `Tool node "${node.id}" references unknown tool "${node.config.toolId}".`,
          nodeId: node.id,
        });
      }
    } else if (node.kind === "goal_handoff") {
      checkTokens(node.config.titleTemplate, node, ancestors, byId, issues);
      if (node.config.tasksTemplate) {
        checkTokens(node.config.tasksTemplate, node, ancestors, byId, issues);
      }
    }
  }

  return {ok: issues.length === 0, issues};
}

function checkTokens(
  text: string,
  node: WorkflowNode,
  ancestors: Map<string, Set<string>>,
  byId: Map<string, WorkflowNode>,
  issues: WorkflowValidationIssue[],
): void {
  for (const {raw, token} of extractWorkflowTokens(text)) {
    if (!token) {
      issues.push({
        code: "bad_token",
        message: `Node "${node.id}" has an unrecognized template token "${raw}".`,
        nodeId: node.id,
      });
      continue;
    }
    if (token.kind === "node") {
      if (!byId.has(token.nodeId)) {
        issues.push({
          code: "token_unknown_node",
          message: `Node "${node.id}" references unknown node "${token.nodeId}" in ${raw}.`,
          nodeId: node.id,
        });
        continue;
      }
      const anc = ancestors.get(node.id);
      if (!anc || !anc.has(token.nodeId)) {
        issues.push({
          code: "token_not_upstream",
          message: `Node "${node.id}" references node "${token.nodeId}" which is not upstream on the main flow (${raw}).`,
          nodeId: node.id,
        });
      }
    }
  }
}

function hasCycle(adj: Map<string, string[]>): boolean {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adj.keys()) color.set(id, WHITE);

  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  };

  for (const id of adj.keys()) {
    if (color.get(id) === WHITE && visit(id)) return true;
  }
  return false;
}

/** For each node, the set of all main-flow ancestor node ids. */
function computeAncestors(adj: Map<string, string[]>): Map<string, Set<string>> {
  // Build reverse adjacency, then BFS from each node.
  const reverse = new Map<string, string[]>();
  for (const id of adj.keys()) reverse.set(id, []);
  for (const [from, tos] of adj) {
    for (const to of tos) reverse.get(to)?.push(from);
  }
  const result = new Map<string, Set<string>>();
  for (const id of adj.keys()) {
    const anc = new Set<string>();
    const stack = [...(reverse.get(id) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (anc.has(cur)) continue;
      anc.add(cur);
      for (const prev of reverse.get(cur) ?? []) stack.push(prev);
    }
    result.set(id, anc);
  }
  return result;
}
