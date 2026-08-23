import { describe, expect, it } from "vitest";
import type { ActivityEvent, ApprovalRequest, Member, Message, RunState } from "@ujima/shared/browser";
import { handleStreamEvent, type StreamEventActions } from "./stream-event-handler";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    organizationId: "org",
    threadId: "thread",
    senderId: "ava",
    senderKind: "agent",
    kind: "agent",
    content: "hello",
    mentions: [],
    toolCalls: [],
    attachments: [],
    metadata: {},
    createdAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "run-1",
    organizationId: "org",
    threadId: "thread",
    agentId: "ava",
    status: "running",
    startedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  } as RunState;
}

function makeApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "ap-1",
    organizationId: "org",
    threadId: "thread",
    runId: "run-1",
    requestedBy: "ava",
    resourceType: "shell",
    resourcePath: "/tmp",
    action: "execute",
    status: "pending",
    reason: "",
    createdAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  } as ApprovalRequest;
}

const members: Member[] = [
  { id: "ava", organizationId: "org", name: "Ava", kind: "agent", roleName: "assistant", presence: "offline" },
];

function makeActions() {
  const calls: string[] = [];
  const actions: StreamEventActions = {
    appendActivity: (event: ActivityEvent) => calls.push(`activity:${event.type}`),
    appendMember: (member: Member) => calls.push(`member:${member.id}`),
    appendRunChunk: (chunk) => calls.push(`chunk:${chunk.kind}:${chunk.delta ?? ""}`),
    flushRunChunks: (key) => calls.push(`flush:${key}`),
    receiveMessage: (tempId, message) => calls.push(`message:${tempId ?? "-"}:${message.id}`),
    removeMessage: (id) => calls.push(`remove:${id}`),
    setConversationError: (message) => calls.push(`error:${message ?? "-"}`),
    setLoading: (loading) => calls.push(`loading:${loading}`),
    setMemberActivity: (memberId, activity) => calls.push(`memberActivity:${memberId}:${activity}`),
    storeMembers: members,
    expectedConversationKey: "org:thread",
    upsertApproval: (approval) => calls.push(`approval:${approval.id}`),
    upsertRun: (run) => calls.push(`run:${run.id}:${run.status}`),
    setRunTokens: (runId, inputTokens, outputTokens) =>
      calls.push(`tokens:${runId}:${inputTokens}:${outputTokens}`),
  };
  return { actions, calls };
}

describe("handleStreamEvent", () => {
  it("ignores non-socket envelopes", () => {
    const { actions, calls } = makeActions();
    handleStreamEvent({ type: "ready" } as never, actions);
    expect(calls).toEqual([]);
  });

  it("routes a channel message through receiveMessage and clears errors for agent senders", () => {
    const { actions, calls } = makeActions();
    handleStreamEvent(
      { type: "socket", event: "channel:message", payload: { message: makeMessage() } },
      actions,
    );
    expect(calls).toEqual(["flush:org:thread", "message:-:m1", "error:-"]);
  });

  it("upserts approvals from approval events", () => {
    const { actions, calls } = makeActions();
    handleStreamEvent(
      { type: "socket", event: "approval:requested", payload: { approval: makeApproval() } },
      actions,
    );
    expect(calls).toEqual(["flush:org:thread", "approval:ap-1"]);
  });

  it("upserts runs and derives member activity on run updates", () => {
    const { actions, calls } = makeActions();
    handleStreamEvent(
      { type: "socket", event: "run:updated", payload: { run: makeRun() } },
      actions,
    );
    expect(calls).toEqual(["flush:org:thread", "run:run-1:running", "memberActivity:ava:working"]);
  });

  it("surfaces failed runs as conversation errors", () => {
    const { actions, calls } = makeActions();
    handleStreamEvent(
      {
        type: "socket",
        event: "run:completed",
        payload: { run: makeRun({ status: "failed", summary: "boom" }) },
      },
      actions,
    );
    expect(calls).toContain("error:boom");
  });

  it("batches run chunks without flushing first", () => {
    const { actions, calls } = makeActions();
    handleStreamEvent(
      {
        type: "socket",
        event: "run:chunk",
        payload: {
          organizationId: "org",
          runId: "run-1",
          threadId: "thread",
          agentId: "ava",
          kind: "text",
          delta: "hi",
        },
      },
      actions,
    );
    expect(calls).toEqual(["chunk:text:hi"]);
  });

  it("records token usage", () => {
    const { actions, calls } = makeActions();
    handleStreamEvent(
      {
        type: "socket",
        event: "run:tokens",
        payload: {
          organizationId: "org",
          runId: "run-1",
          agentId: "ava",
          inputTokens: 3,
          outputTokens: 5,
        },
      },
      actions,
    );
    expect(calls).toEqual(["flush:org:thread", "tokens:run-1:3:5"]);
  });

  it("marks alerted members online and appends activity", () => {
    const { actions, calls } = makeActions();
    handleStreamEvent(
      {
        type: "socket",
        event: "member.alerted",
        payload: {
          organizationId: "org",
          memberId: "ava",
          messageId: "m1",
          byMemberId: "human",
          reason: "mention",
        },
      },
      actions,
    );
    expect(calls).toEqual(["flush:org:thread", "memberActivity:ava:online", "activity:member_alerted"]);
  });

  it("flags must_reply_failed as a conversation error", () => {
    const { actions, calls } = makeActions();
    handleStreamEvent(
      { type: "socket", event: "member.must_reply_failed", payload: { memberId: "ava" } },
      actions,
    );
    expect(calls).toEqual([
      "flush:org:thread",
      "memberActivity:ava:error",
      "error:Agent was @mentioned but did not reply.",
    ]);
  });

  it("drops payloads that fail schema validation", () => {
    const { actions, calls } = makeActions();
    handleStreamEvent(
      { type: "socket", event: "channel:message", payload: { message: { id: "broken" } } },
      actions,
    );
    expect(calls).toEqual(["flush:org:thread"]);
  });
});
