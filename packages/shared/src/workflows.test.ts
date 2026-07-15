import {describe, expect, it} from "vitest";
import {
  WorkflowGraphSchema,
  WorkflowNodeSchema,
  extractWorkflowTokens,
  parseWorkflowToken,
  validateWorkflowGraph,
  type WorkflowGraph,
} from "./workflows.js";

function graph(partial: Partial<WorkflowGraph>): WorkflowGraph {
  return {nodes: partial.nodes ?? [], edges: partial.edges ?? []};
}

// A minimal valid SOP: trigger -> agent(+skill) -> approval -> agent -> goal.
function validSop(): WorkflowGraph {
  return {
    nodes: [
      {id: "t", kind: "trigger", position: {x: 0, y: 0}, config: {source: "mention"}},
      {
        id: "pm",
        kind: "agent",
        position: {x: 1, y: 0},
        config: {agentId: "pm", prompt: "Write a BRD for {{input}}. Save to {{node.output}}.", outputPath: "docs/{{workflow_run_id}}/brd.md", requiresApproval: false},
      },
      {id: "brd", kind: "skill", position: {x: 1, y: 1}, config: {skillName: "brd"}},
      {id: "gate", kind: "approval", position: {x: 2, y: 0}, config: {}},
      {
        id: "eng",
        kind: "agent",
        position: {x: 3, y: 0},
        config: {agentId: "eng", prompt: "Read {{nodes.pm.output}} and build tasks."},
      },
      {
        id: "goal",
        kind: "goal_handoff",
        position: {x: 4, y: 0},
        config: {titleTemplate: "{{input}}", tasksFrom: "json"},
      },
    ],
    edges: [
      {id: "e1", source: "t", sourcePort: "main", target: "pm", targetPort: "main"},
      {id: "e2", source: "brd", sourcePort: "ai_skill", target: "pm", targetPort: "ai_skill"},
      {id: "e3", source: "pm", sourcePort: "main", target: "gate", targetPort: "main"},
      {id: "e4", source: "gate", sourcePort: "main", target: "eng", targetPort: "main"},
      {id: "e5", source: "eng", sourcePort: "main", target: "goal", targetPort: "main"},
    ],
  };
}

describe("WorkflowNodeSchema", () => {
  it("parses a discriminated agent node with defaults", () => {
    const node = WorkflowNodeSchema.parse({
      id: "a",
      kind: "agent",
      position: {x: 0, y: 0},
      config: {agentId: "pm"},
    });
    expect(node.kind).toBe("agent");
    if (node.kind === "agent") {
      expect(node.config.requiresApproval).toBe(false);
      expect(node.config.prompt).toBe("");
    }
  });

  it("rejects an agent node without an agentId", () => {
    expect(() =>
      WorkflowNodeSchema.parse({id: "a", kind: "agent", position: {x: 0, y: 0}, config: {}}),
    ).toThrow();
  });

  it("parses an output node and defaults the format to markdown", () => {
    const node = WorkflowNodeSchema.parse({
      id: "o",
      kind: "output",
      position: {x: 0, y: 0},
      config: {},
    });
    expect(node.kind).toBe("output");
    if (node.kind === "output") expect(node.config.format).toBe("markdown");
  });
});

describe("validateWorkflowGraph — output node", () => {
  function sopWithOutput(outputPath?: string): WorkflowGraph {
    return graph({
      nodes: [
        {id: "t", kind: "trigger", position: {x: 0, y: 0}, config: {source: "mention"}},
        {id: "a", kind: "agent", position: {x: 1, y: 0}, config: {agentId: "pm", prompt: "x"}},
        {id: "out", kind: "output", position: {x: 2, y: 0}, config: {format: "table", outputPath}},
      ],
      edges: [
        {id: "e1", source: "t", sourcePort: "main", target: "a", targetPort: "main"},
        {id: "e2", source: "a", sourcePort: "main", target: "out", targetPort: "main"},
      ],
    });
  }

  it("accepts an output node on the main flow", () => {
    expect(validateWorkflowGraph(sopWithOutput("workflows/{{workflow_run_id}}/out.md")).ok).toBe(true);
  });

  it("rejects an output node whose path escapes the workspace", () => {
    const result = validateWorkflowGraph(sopWithOutput("/etc/passwd"));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "output_path_escape")).toBe(true);
  });
});

describe("parseWorkflowToken", () => {
  it("parses each allowed token form", () => {
    expect(parseWorkflowToken("input")).toEqual({kind: "input"});
    expect(parseWorkflowToken("workflow_run_id")).toEqual({kind: "workflow_run_id"});
    expect(parseWorkflowToken("node.output")).toEqual({kind: "self_output"});
    expect(parseWorkflowToken("nodes.pm.summary")).toEqual({
      kind: "node",
      nodeId: "pm",
      field: "summary",
    });
  });

  it("rejects malformed tokens", () => {
    expect(parseWorkflowToken("Nodes.pm.output")).toBeNull();
    expect(parseWorkflowToken("nodes.pm.bogus")).toBeNull();
    expect(parseWorkflowToken("random")).toBeNull();
  });

  it("extracts tokens from text", () => {
    const found = extractWorkflowTokens("Read {{nodes.pm.output}} then {{input}}");
    expect(found.map((f) => f.token?.kind)).toEqual(["node", "input"]);
  });
});

describe("validateWorkflowGraph", () => {
  it("accepts a valid SOP", () => {
    expect(WorkflowGraphSchema.safeParse(validSop()).success).toBe(true);
    const res = validateWorkflowGraph(validSop());
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it("flags duplicate node ids", () => {
    const g = validSop();
    g.nodes.push({id: "pm", kind: "approval", position: {x: 9, y: 9}, config: {}});
    const res = validateWorkflowGraph(g);
    expect(res.issues.some((i) => i.code === "duplicate_node_id")).toBe(true);
  });

  it("flags a skill node placed on the main flow", () => {
    const g = validSop();
    g.edges.push({id: "bad", source: "brd", sourcePort: "main", target: "gate", targetPort: "main"});
    const res = validateWorkflowGraph(g);
    expect(res.issues.some((i) => i.code === "subnode_on_main_flow")).toBe(true);
  });

  it("flags an ai_skill edge attached to a non-agent node", () => {
    const g = validSop();
    g.edges.push({id: "bad", source: "brd", sourcePort: "ai_skill", target: "gate", targetPort: "ai_skill"});
    const res = validateWorkflowGraph(g);
    expect(res.issues.some((i) => i.code === "subnode_target_not_agent")).toBe(true);
  });

  it("flags a token referencing a downstream (non-upstream) node", () => {
    const g = validSop();
    // pm references eng, which is downstream of pm — illegal.
    const pm = g.nodes.find((n) => n.id === "pm")!;
    if (pm.kind === "agent") pm.config.prompt = "See {{nodes.eng.output}}";
    const res = validateWorkflowGraph(g);
    expect(res.issues.some((i) => i.code === "token_not_upstream")).toBe(true);
  });

  it("flags a cycle in the main flow", () => {
    const g = validSop();
    g.edges.push({id: "cyc", source: "goal", sourcePort: "main", target: "pm", targetPort: "main"});
    const res = validateWorkflowGraph(g);
    expect(res.issues.some((i) => i.code === "main_flow_cycle")).toBe(true);
  });

  it("flags an output path escaping the workspace", () => {
    const g = validSop();
    const pm = g.nodes.find((n) => n.id === "pm")!;
    if (pm.kind === "agent") pm.config.outputPath = "../../etc/passwd";
    const res = validateWorkflowGraph(g);
    expect(res.issues.some((i) => i.code === "output_path_escape")).toBe(true);
  });

  it("flags unknown agent/skill/tool refs when a context is supplied", () => {
    const res = validateWorkflowGraph(validSop(), {
      agentIds: new Set(["pm"]),
      skillNames: new Set(["brd"]),
    });
    // eng is not in the agentIds set
    expect(res.issues.some((i) => i.code === "unknown_agent")).toBe(true);
  });

  it("flags an agent node with no agent selected", () => {
    const g = validSop();
    const pm = g.nodes.find((n) => n.id === "pm")!;
    if (pm.kind === "agent") pm.config.agentId = "";
    const res = validateWorkflowGraph(g);
    expect(res.issues.some((i) => i.code === "incomplete_node" && i.nodeId === "pm")).toBe(true);
  });

  it("flags a skill node with no skill selected", () => {
    const g = validSop();
    const brd = g.nodes.find((n) => n.id === "brd")!;
    if (brd.kind === "skill") brd.config.skillName = "";
    const res = validateWorkflowGraph(g);
    expect(res.issues.some((i) => i.code === "incomplete_node" && i.nodeId === "brd")).toBe(true);
  });

  it("requires exactly one trigger", () => {
    const g = validSop();
    g.nodes = g.nodes.filter((n) => n.kind !== "trigger");
    expect(validateWorkflowGraph(g).issues.some((i) => i.code === "missing_trigger")).toBe(true);
  });
});
