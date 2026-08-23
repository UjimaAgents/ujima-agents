import {describe, expect, it} from "vitest";
import type {WorkflowEdge} from "@ujima/shared";
import {graphToFlow} from "./graph-flow";

describe("graphToFlow", () => {
  it("renders an incomplete skill draft so the editor can validate it", () => {
    const {flowNodes} = graphToFlow(
      [{id: "skill-1", kind: "skill", position: {x: 0, y: 0}, config: {skillName: ""}}],
      [],
    );

    expect(flowNodes[0]?.data.node).toMatchObject({
      id: "skill-1",
      kind: "skill",
      config: {skillName: ""},
    });
  });

  it("infers capability ports for legacy edges", () => {
    const {flowEdges} = graphToFlow(
      [
        {id: "agent-1", kind: "agent", position: {x: 0, y: 0}, config: {agentId: "agent-1"}},
        {id: "skill-1", kind: "skill", position: {x: 0, y: 100}, config: {skillName: "brief"}},
      ],
      [{id: "edge-1", source: "skill-1", target: "agent-1"} as unknown as WorkflowEdge],
    );

    expect(flowEdges[0]).toMatchObject({
      sourceHandle: "cap-out",
      targetHandle: "cap-in",
      data: {port: "ai_skill"},
    });
  });
});
