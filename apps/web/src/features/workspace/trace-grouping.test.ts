import { describe, expect, it } from "vitest";
import type { TraceStepData } from "./components/chat/details-sidebar";
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

function reasoningStep(input: { id: string; actorId: string; actor: string }): TraceStepData {
  return {
    id: input.id,
    title: `${input.actor} · reasoning`,
    detail: "thinking",
    time: "00:00",
    duration: "—",
    status: "running",
    actorId: input.actorId,
    actorName: input.actor,
  };
}

function runStartStep(input: { id: string; actorId: string; actor: string; status?: TraceStepData["status"] }): TraceStepData {
  return {
    id: input.id,
    title: "Run · Running",
    detail: "",
    time: "00:00",
    duration: "—",
    status: input.status ?? "running",
    actorId: input.actorId,
    actorName: input.actor,
  };
}

describe("groupTraceSteps", () => {
  it("returns an empty array for an empty input", () => {
    expect(groupTraceSteps([])).toEqual([]);
  });

  it("keeps distinct agents in distinct groups when their display names share a first word", () => {
    const steps: TraceStepData[] = [
      fsStep({ id: "s1", actorId: "carter-jordan", actor: "Carter Jordan", verb: "is writing to", path: "/foo.ts" }),
      fsStep({ id: "s2", actorId: "carter-smith", actor: "Carter Smith", verb: "is writing to", path: "/bar.ts" }),
      fsStep({ id: "s3", actorId: "carter-jordan", actor: "Carter Jordan", verb: "deleted file", path: "/baz.ts" }),
    ];

    const grouped = groupTraceSteps(steps);

    expect(grouped).toHaveLength(3);
    expect(grouped.map((g) => g.aggregatedOperations?.length ?? 0)).toEqual([1, 1, 1]);
    expect(grouped.map((g) => g.actorId)).toEqual(["carter-jordan", "carter-smith", "carter-jordan"]);
    expect(grouped.map((g) => g.title)).toEqual([
      "Carter Jordan · completed",
      "Carter Smith · completed",
      "Carter Jordan · completed",
    ]);
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

  it("breaks a tool group when a non-tool step (reasoning) appears between", () => {
    const steps: TraceStepData[] = [
      fsStep({ id: "s1", actorId: "jerry", actor: "Jerry Wilson", verb: "is writing to", path: "/foo.ts" }),
      reasoningStep({ id: "r1", actorId: "jerry", actor: "Jerry Wilson" }),
      fsStep({ id: "s2", actorId: "jerry", actor: "Jerry Wilson", verb: "is writing to", path: "/bar.ts" }),
    ];

    const grouped = groupTraceSteps(steps);

    expect(grouped).toHaveLength(3);
    expect(grouped[0]?.aggregatedOperations).toHaveLength(1);
    expect(grouped[1]?.aggregatedOperations).toBeUndefined();
    expect(grouped[2]?.aggregatedOperations).toHaveLength(1);
  });

  it("opens a group from a 'Run · ...' sentinel and merges subsequent tool steps from the same actor", () => {
    const steps: TraceStepData[] = [
      runStartStep({ id: "run-1", actorId: "carter", actor: "Carter Jordan" }),
      fsStep({ id: "s1", actorId: "carter", actor: "Carter Jordan", verb: "is writing to", path: "/foo.ts" }),
      fsStep({ id: "s2", actorId: "carter", actor: "Carter Jordan", verb: "is writing to", path: "/bar.ts" }),
    ];

    const grouped = groupTraceSteps(steps);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.actorId).toBe("carter");
    expect(grouped[0]?.aggregatedOperations).toHaveLength(2);
  });

  it("splits same-actor tool steps into separate groups when they belong to different runs", () => {
    const steps: TraceStepData[] = [
      fsStep({ id: "s1", actorId: "jerry", actor: "Jerry", verb: "is writing to", path: "/a.ts", runId: "run-1" }),
      fsStep({ id: "s2", actorId: "jerry", actor: "Jerry", verb: "is writing to", path: "/b.ts", runId: "run-1" }),
      fsStep({ id: "s3", actorId: "jerry", actor: "Jerry", verb: "is writing to", path: "/c.ts", runId: "run-2" }),
    ];

    const grouped = groupTraceSteps(steps);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.runId).toBe("run-1");
    expect(grouped[0]?.aggregatedOperations).toHaveLength(2);
    expect(grouped[1]?.runId).toBe("run-2");
    expect(grouped[1]?.aggregatedOperations).toHaveLength(1);
  });

  it("escalates group status to 'failed' once any operation fails, even if later ops succeed", () => {
    const steps: TraceStepData[] = [
      fsStep({ id: "s1", actorId: "jerry", actor: "Jerry", verb: "is writing to", path: "/a.ts", status: "success" }),
      fsStep({ id: "s2", actorId: "jerry", actor: "Jerry", verb: "is writing to", path: "/b.ts", status: "failed" }),
      fsStep({ id: "s3", actorId: "jerry", actor: "Jerry", verb: "is writing to", path: "/c.ts", status: "success" }),
    ];

    const grouped = groupTraceSteps(steps);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.status).toBe("failed");
    expect(grouped[0]?.title).toBe("Jerry · failed");
  });
});
