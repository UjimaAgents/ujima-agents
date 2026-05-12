import { describe, expect, it } from "vitest";
import { pendingApprovalVisibleInChannelView, queueApprovals } from "./approval-thread-filter";

describe("pendingApprovalVisibleInChannelView", () => {
  const dmThreadIvy = "dm:human:ivy";
  const dmThreadAva = "dm:human:ava";

  it("hides Ivy approval in Ava agent tab when threadId points at Ivy DM", () => {
    const visible = pendingApprovalVisibleInChannelView(
      {
        status: "pending",
        requestedByMemberId: "ivy",
        requestedBy: "Ivy",
        threadId: dmThreadIvy,
        runId: "run-1",
      },
      { type: "agent", id: "ava" },
      dmThreadAva,
      [{ id: "run-1", threadId: dmThreadIvy }],
    );
    expect(visible).toBe(false);
  });

  it("shows Ivy approval in Ivy agent tab for same thread", () => {
    const visible = pendingApprovalVisibleInChannelView(
      {
        status: "pending",
        requestedByMemberId: "ivy",
        requestedBy: "Ivy",
        threadId: dmThreadIvy,
        runId: "run-1",
      },
      { type: "agent", id: "ivy" },
      dmThreadIvy,
      [{ id: "run-1", threadId: dmThreadIvy }],
    );
    expect(visible).toBe(true);
  });

  it("falls back to run.threadId for legacy approvals without threadId on approval", () => {
    const visible = pendingApprovalVisibleInChannelView(
      {
        status: "pending",
        requestedByMemberId: "ivy",
        requestedBy: "Ivy",
        runId: "run-1",
      },
      { type: "agent", id: "ivy" },
      dmThreadIvy,
      [{ id: "run-1", threadId: dmThreadIvy }],
    );
    expect(visible).toBe(true);
  });

  it("hides legacy approval when run thread does not match current DM", () => {
    const visible = pendingApprovalVisibleInChannelView(
      {
        status: "pending",
        requestedByMemberId: "ivy",
        requestedBy: "Ivy",
        runId: "run-1",
      },
      { type: "agent", id: "ivy" },
      dmThreadAva,
      [{ id: "run-1", threadId: dmThreadIvy }],
    );
    expect(visible).toBe(false);
  });
});

describe("queueApprovals", () => {
  it("keeps the earliest created pending approval visible first", () => {
    const approvals = queueApprovals([
      { id: "b", status: "pending", runId: "run-1", createdAt: "2026-05-12T08:00:02.000Z" },
      { id: "a", status: "pending", runId: "run-1", createdAt: "2026-05-12T08:00:01.000Z" },
      { id: "c", status: "approved", runId: "run-1", createdAt: "2026-05-12T08:00:03.000Z" },
    ]);

    expect(approvals.map((approval) => approval.id)).toEqual(["a", "c"]);
  });
});
