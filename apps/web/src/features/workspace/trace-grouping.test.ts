import { describe, expect, it } from "vitest";
import type { TraceStepData } from "./components/chat/trace-types";
import { groupTraceSteps } from "./trace-grouping";

const WRITE_VERBS = ["writing", "deleted", "created", "updated"];

function fsStep(input: {
  id: string;
  actorId: string;
  actor: string;
  verb: string;
  path: string;
  status?: TraceStepData["status"];
  runId?: string;
}): TraceStepData {
  const isWrite = WRITE_VERBS.some((v) => input.verb.includes(v));
  return {
    id: input.id,
    title: `${input.actor} ${input.verb} ${input.path}`,
    detail: "",
    time: "00:00",
    duration: "—",
    status: input.status ?? "success",
    actorId: input.actorId,
    actorName: input.actor,
    ...(input.runId ? { runId: input.runId } : {}),
    filesystem: {
      action: isWrite ? "write" : "read",
      resourcePath: input.path,
    },
  };
}

describe("groupTraceSteps", () => {
  it("returns an empty array for an empty input", () => {
    expect(groupTraceSteps([])).toEqual([]);
  });

  it("folds consecutive tool steps from the same actor into a single group", () => {
    const steps: TraceStepData[] = [
      fsStep({ id: "s1", actorId: "carter-jordan", actor: "Carter Jordan", verb: "is writing to", path: "/foo.ts" }),
      {
        id: "tool:tc-1::",
        actorId: "carter-jordan",
        actorName: "Carter Jordan",
        title: "Carter Jordan called tool channel.reply",
        detail: "",
        time: "00:00",
        duration: "—",
        status: "success",
      },
    ];

    const grouped = groupTraceSteps(steps);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.actorId).toBe("carter-jordan");
    expect(grouped[0]?.aggregatedOperations).toHaveLength(2);
    expect(grouped[0]?.title).toBe("Carter Jordan · completed");
  });

  it("preserves structured payloads for memory and message tool UX", () => {
    const steps: TraceStepData[] = [
      {
        id: "tool:memory",
        actorId: "carter-jordan",
        actorName: "Carter Jordan",
        title: "Carter Jordan called tool memory.write",
        toolName: "memory.write",
        toolInput: { key: "user.preference", value: "Concise" },
        toolResult: { status: "ok" },
        detail: "",
        time: "00:00",
        duration: "—",
        status: "success",
      },
      {
        id: "tool:reply",
        actorId: "carter-jordan",
        actorName: "Carter Jordan",
        title: "Carter Jordan called tool channel.reply",
        toolName: "channel.reply",
        toolInput: { message_id: "msg-1", body: "Done" },
        toolResult: { status: "sent" },
        detail: "",
        time: "00:00",
        duration: "—",
        status: "success",
      },
    ];

    const grouped = groupTraceSteps(steps);
    const operations = grouped[0]?.aggregatedOperations;

    expect(operations?.[0]).toMatchObject({
      type: "memory",
      toolName: "memory.write",
      toolInput: { key: "user.preference", value: "Concise" },
    });
    expect(operations?.[1]).toMatchObject({
      type: "message",
      toolName: "channel.reply",
      toolInput: { message_id: "msg-1", body: "Done" },
    });
  });

});
