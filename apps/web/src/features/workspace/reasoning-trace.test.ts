import { describe, expect, it } from "vitest";
import type { ActivityEvent, RunState } from "@ujima/shared/browser";
import { buildReasoningTraceSteps } from "./reasoning-trace";

describe("reasoning-trace ordering", () => {
  it("keeps reasoning chunks, tool calls, tool results, and text in arrival order", () => {
    const organizationId = "org-1";
    const threadId = "thread-1";
    const agentId = "Quinn Mason";
    const runningTs = "2026-05-04T19:07:12.000Z";
    const reasoningTs = "2026-05-04T19:07:09.000Z";
    const calledTs = "2026-05-04T19:07:08.000Z";
    const resultTs = "2026-05-04T19:07:11.000Z";
    const textTs = "2026-05-04T19:07:10.000Z";
    const run: RunState = {
      id: "run-1",
      organizationId,
      agentId,
      threadId,
      status: "running",
      step: "running",
      summary: "running",
      startedAt: runningTs,
    };
    const activity: ActivityEvent[] = [
      {
        event_id: "tool:called:run-1:tc-1",
        type: "tool_called",
        publisher: agentId,
        timestamp: calledTs,
        order: 2,
        payload: {
          runId: run.id,
          threadId,
          agentId,
          toolCall: {
            toolCallId: "tc-1",
            toolName: "shell",
            args: {},
          },
        },
      },
      {
        event_id: "run_chunk:run-1:1:reasoning",
        type: "run_chunk",
        publisher: agentId,
        timestamp: reasoningTs,
        order: 1,
        payload: {
          runId: run.id,
          threadId,
          agentId,
          kind: "reasoning",
          delta: "Thinking first.",
        },
      },
      {
        event_id: "run_chunk:run-1:1b:reasoning",
        type: "run_chunk",
        publisher: agentId,
        timestamp: "2026-05-04T19:07:09.500Z",
        order: 1.5,
        payload: {
          runId: run.id,
          threadId,
          agentId,
          kind: "reasoning",
          delta: " Still thinking.",
        },
      },
      {
        event_id: "run:run-1:running:running:0",
        type: "run_running",
        publisher: agentId,
        timestamp: runningTs,
        order: 0,
        payload: run,
      },
      {
        event_id: "tool:result:run-1:tc-1",
        type: "tool_result",
        publisher: agentId,
        timestamp: resultTs,
        order: 3,
        payload: {
          runId: run.id,
          threadId,
          agentId,
          toolResult: {
            toolCallId: "tc-1",
            result: { status: "ok" },
            isError: false,
          },
        },
      },
      {
        event_id: "run_chunk:run-1:2:text",
        type: "run_chunk",
        publisher: agentId,
        timestamp: textTs,
        order: 4,
        payload: {
          runId: run.id,
          threadId,
          agentId,
          kind: "text",
          delta: "Then text.",
        },
      },
    ];

    const steps = buildReasoningTraceSteps({
      threadId,
      agentIdFilter: agentId,
      conversationName: "Quinn Mason",
      conversationType: "agent",
      members: [{ id: agentId, name: "Quinn Mason", kind: "agent" }],
      activity,
      runs: [run],
      organizationId,
    });

    expect(steps.map((step) => step.title)).toEqual([
      "Run · Running",
      "Quinn Mason · reasoning",
      "Quinn Mason · shell",
      "Quinn Mason · text",
    ]);
    expect(steps.find((step) => step.title === "Quinn Mason · reasoning")?.detail).toBe(
      "Thinking first. Still thinking.",
    );
  });
});
