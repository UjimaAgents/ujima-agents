import { describe, expect, it } from "vitest";
import type { ActivityEvent, Message, RunState } from "@ujima/shared/browser";
import { buildHistoricalTraceSteps, buildReasoningTraceSteps } from "./reasoning-trace";

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
        event_id: "run_chunk:run-1:1c:reasoning",
        type: "run_chunk",
        publisher: agentId,
        timestamp: "2026-05-04T19:07:09.750Z",
        order: 1.75,
        payload: {
          runId: run.id,
          threadId,
          agentId,
          kind: "reasoning",
          delta: " More thinking.",
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
        event_id: "run_chunk:run-1:1d:reasoning",
        type: "run_chunk",
        publisher: agentId,
        timestamp: "2026-05-04T19:07:10.500Z",
        order: 2.5,
        payload: {
          runId: run.id,
          threadId,
          agentId,
          kind: "reasoning",
          delta: " Thinking after tool call.",
        },
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
      "Quinn Mason · reasoning",
      "Quinn Mason · text",
    ]);
    const reasoningSteps = steps.filter((step) => step.title === "Quinn Mason · reasoning");
    expect(reasoningSteps.map((step) => step.detail)).toEqual([
      "Thinking first. Still thinking. More thinking.",
      " Thinking after tool call.",
    ]);
  });

  it("shows buffered output for running background jobs", () => {
    const activity: ActivityEvent[] = [
      {
        event_id: "tool:called:run-1:tc-1",
        type: "tool_called",
        publisher: "agent-1",
        timestamp: "2026-05-04T19:07:08.000Z",
        payload: {
          runId: "run-1",
          threadId: "thread-1",
          agentId: "agent-1",
          toolCall: {
            toolCallId: "tc-1",
            toolName: "job_output",
            args: { job_id: "job-1" },
          },
        },
      },
      {
        event_id: "tool:result:run-1:tc-1",
        type: "tool_result",
        publisher: "agent-1",
        timestamp: "2026-05-04T19:07:09.000Z",
        payload: {
          runId: "run-1",
          threadId: "thread-1",
          agentId: "agent-1",
          toolResult: {
            toolCallId: "tc-1",
            result: {
              id: "job-1",
              status: "running",
              cwd: "/workspace",
              commandLine: "bun test",
              stdout: "one passing test\n",
              stderr: "",
            },
            isError: false,
          },
        },
      },
    ];

    const steps = buildReasoningTraceSteps({
      threadId: "thread-1",
      agentIdFilter: "agent-1",
      conversationName: "Agent",
      conversationType: "agent",
      members: [{ id: "agent-1", name: "Agent", kind: "agent" }],
      activity,
      runs: [],
      organizationId: "org-1",
    });

    expect(steps[0]?.terminal?.output).toBe("one passing test");
  });

  it("rebuilds persisted reasoning and text as separate historical trace rows", () => {
    const organizationId = "org-1";
    const threadId = "thread-1";
    const agentId = "agent-1";
    const run: RunState = {
      id: "run-1",
      organizationId,
      agentId,
      threadId,
      status: "completed",
      step: "completed",
      summary: "done",
      startedAt: "2026-05-04T19:07:00.000Z",
      endedAt: "2026-05-04T19:07:02.000Z",
    };
    const message: Message = {
      id: "msg-1",
      organizationId,
      threadId,
      senderId: agentId,
      senderKind: "agent",
      kind: "agent",
      content: "Final answer.",
      reasoningContent: "Private reasoning.",
      mentions: [],
      toolCalls: [],
      attachments: [],
      metadata: { runId: run.id },
      createdAt: "2026-05-04T19:07:02.000Z",
    };

    const steps = buildHistoricalTraceSteps({
      conversationName: "Agent",
      conversationType: "agent",
      members: [{ id: agentId, name: "Agent", kind: "agent" }],
      run,
      steps: [],
      message,
      organizationId,
    });

    expect(steps.map((step) => [step.title, step.detail])).toEqual([
      ["Run · Completed", ""],
      ["Agent · reasoning", "Private reasoning."],
      ["Agent · text", "Final answer."],
    ]);
  });
});
