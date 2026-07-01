import { describe, expect, it } from "vitest";
import type { ActivityEvent, RunState } from "@ujima/shared/browser";
import {
  buildHistoricalTraceSteps,
  buildReasoningTraceSteps,
} from "./reasoning-trace";
import { collapseRunChunkActivities } from "./run-chunk-activity";

describe("reasoning-trace ordering", () => {
  it("collapses consecutive run_chunk events before trace derivation", () => {
    const collapsed = collapseRunChunkActivities([
      {
        event_id: "chunk-1",
        type: "run_chunk",
        publisher: "ava",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: {
          runId: "run-1",
          threadId: "thread-1",
          agentId: "ava",
          kind: "reasoning",
          delta: "A",
        },
      },
      {
        event_id: "chunk-2",
        type: "run_chunk",
        publisher: "ava",
        timestamp: "2026-01-01T00:00:01.000Z",
        payload: {
          runId: "run-1",
          threadId: "thread-1",
          agentId: "ava",
          kind: "reasoning",
          delta: "B",
        },
      },
      {
        event_id: "tool-1",
        type: "tool_called",
        publisher: "ava",
        timestamp: "2026-01-01T00:00:02.000Z",
        payload: {
          runId: "run-1",
          threadId: "thread-1",
          agentId: "ava",
          toolCall: { toolCallId: "tc-1", toolName: "shell", args: {} },
        },
      },
      {
        event_id: "chunk-3",
        type: "run_chunk",
        publisher: "ava",
        timestamp: "2026-01-01T00:00:03.000Z",
        payload: {
          runId: "run-1",
          threadId: "thread-1",
          agentId: "ava",
          kind: "text",
          delta: "C",
        },
      },
    ]);

    expect(collapsed).toHaveLength(3);
    expect((collapsed[0]?.payload as { delta?: string }).delta).toBe("AB");
    expect(collapsed[1]?.type).toBe("tool_called");
    expect((collapsed[2]?.payload as { delta?: string }).delta).toBe("C");
  });

  it("keeps a merged reasoning segment at the first chunk position", () => {
    const organizationId = "org-1";
    const threadId = "thread-1";
    const agentId = "Quinn Mason";
    const run: RunState = {
      id: "run-1",
      organizationId,
      agentId,
      threadId,
      status: "running",
      step: "running",
      summary: "running",
      startedAt: "2026-05-04T19:07:00.000Z",
    };
    const steps = buildReasoningTraceSteps({
      threadId,
      agentIdFilter: agentId,
      conversationName: "Quinn Mason",
      conversationType: "agent",
      members: [{ id: agentId, name: "Quinn Mason", kind: "agent" }],
      runs: [run],
      organizationId,
      activity: [
        {
          event_id: "run:run-1:running:running:0",
          type: "run_running",
          publisher: agentId,
          timestamp: "2026-05-04T19:07:00.000Z",
          order: 0,
          payload: run,
        },
        {
          event_id: "run_chunk:run-1:1:reasoning",
          type: "run_chunk",
          publisher: agentId,
          timestamp: "2026-05-04T19:07:01.000Z",
          order: 1,
          payload: { runId: run.id, threadId, agentId, kind: "reasoning", delta: "Thinking." },
        },
        {
          event_id: "run_chunk:run-1:3:reasoning",
          type: "run_chunk",
          publisher: agentId,
          timestamp: "2026-05-04T19:07:03.000Z",
          order: 3,
          payload: { runId: run.id, threadId, agentId, kind: "reasoning", delta: " Still thinking." },
        },
        {
          event_id: "tool:called:run-1:tc-1",
          type: "tool_called",
          publisher: agentId,
          timestamp: "2026-05-04T19:07:02.000Z",
          order: 2,
          payload: {
            runId: run.id,
            threadId,
            agentId,
            toolCall: { toolCallId: "tc-1", toolName: "shell", args: {} },
          },
        },
      ],
    });

    expect(steps.map((step) => step.title)).toEqual([
      "Run · Running",
      "Quinn Mason · reasoning",
      "Quinn Mason · shell",
    ]);
    expect(steps.find((step) => step.title === "Quinn Mason · reasoning")?.detail).toBe(
      "Thinking. Still thinking.",
    );
  });

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

  it("threads actorId and actorName onto every step kind so the panel can group by stable identity", () => {
    const organizationId = "org-1";
    const threadId = "thread-1";
    const actorId = "carter-jordan";
    const actorName = "Carter Jordan";
    const run: RunState = {
      id: "run-1",
      organizationId,
      agentId: actorId,
      threadId,
      status: "running",
      step: "running",
      summary: "running",
      startedAt: "2026-05-04T19:07:00.000Z",
    };
    const activity: ActivityEvent[] = [
      {
        event_id: "run:run-1:running:running:0",
        type: "run_running",
        publisher: actorId,
        timestamp: run.startedAt,
        order: 0,
        payload: run,
      },
      {
        event_id: "run_chunk:run-1:1:reasoning",
        type: "run_chunk",
        publisher: actorId,
        timestamp: "2026-05-04T19:07:01.000Z",
        order: 1,
        payload: { runId: run.id, threadId, agentId: actorId, kind: "reasoning", delta: "Thinking…" },
      },
      {
        event_id: "tool:called:run-1:tc-1",
        type: "tool_called",
        publisher: actorId,
        timestamp: "2026-05-04T19:07:02.000Z",
        order: 2,
        payload: {
          runId: run.id,
          threadId,
          agentId: actorId,
          toolCall: { toolCallId: "tc-1", toolName: "shell", args: { cwd: "/workspace", cmd: "ls" } },
        },
      },
      {
        event_id: "tool:result:run-1:tc-1",
        type: "tool_result",
        publisher: actorId,
        timestamp: "2026-05-04T19:07:03.000Z",
        order: 3,
        payload: {
          runId: run.id,
          threadId,
          agentId: actorId,
          toolResult: { toolCallId: "tc-1", result: "ok", isError: false },
        },
      },
      {
        event_id: "msg:msg-1",
        type: "channel_message",
        publisher: actorId,
        timestamp: "2026-05-04T19:07:04.000Z",
        order: 4,
        payload: { messageId: "msg-1", threadId, content: "Done." },
      },
    ];

    const steps = buildReasoningTraceSteps({
      threadId,
      conversationName: "general",
      conversationType: "channel",
      members: [{ id: actorId, name: actorName, kind: "agent" }],
      activity,
      runs: [run],
      organizationId,
    });

    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.actorId).toBe(actorId);
      expect(step.actorName).toBe(actorName);
    }
    // Run-bound steps (chunks, tool calls, tool results) carry the
    // owning runId so the grouper can split same-actor activity from
    // different runs. Channel messages without an attached task_id
    // legitimately have no runId.
    const runBoundSteps = steps.filter(
      (s) => s.id.startsWith("run:") || s.id.startsWith("run_chunk:") || s.id.startsWith("tool:"),
    );
    expect(runBoundSteps.length).toBeGreaterThan(0);
    for (const step of runBoundSteps) {
      expect(step.runId).toBe(run.id);
    }
  });

  it("renders historical skill reads as skill panes when stored as read skill steps", () => {
    const run: RunState = {
      id: "run-skill",
      organizationId: "org-1",
      agentId: "carter-jordan",
      threadId: "dm:carter-jordan:owner",
      status: "completed",
      step: "done",
      summary: "done",
      startedAt: "2026-07-01T06:55:07.000Z",
    };

    const steps = buildHistoricalTraceSteps({
      conversationName: "Carter Jordan",
      conversationType: "agent",
      members: [{ id: "carter-jordan", name: "Carter Jordan", kind: "agent" }],
      run,
      steps: [
        {
          id: "step-skill",
          organizationId: "org-1",
          runId: run.id,
          threadId: run.threadId,
          agentId: run.agentId,
          toolCallId: "call-skill",
          toolId: "read",
          action: "read",
          resourceType: "skill",
          resourcePath: "",
          input: { name: "agent-skills:incremental-implementation" },
          output:
            "<loaded_skill>\n  <name>agent-skills:incremental-implementation</name>\n  <description>Delivers changes incrementally.</description>\n  <instructions>\nFix smallest piece first.\n  </instructions>\n</loaded_skill>",
          status: "ok",
          createdAt: "2026-07-01T06:55:15.417Z",
        },
      ],
      organizationId: "org-1",
    });

    const skillStep = steps.find((step) => step.skillRead);
    expect(skillStep?.toolName).toBe("skill.read");
    expect(skillStep?.skillRead?.skillName).toBe("agent-skills:incremental-implementation");
    expect(skillStep?.skillRead?.output).toContain("<loaded_skill>");
  });

});
