/**
 * Pure helpers for binding pending approvals to the visible conversation.
 * Keeps channel view and tests aligned on the same ownership rules.
 */

export type PendingApprovalLike = {
  status: string;
  /** Stable member id of the requesting agent (preferred for filtering). */
  requestedByMemberId?: string;
  /** Display name; used only as legacy fallback when `requestedByMemberId` is absent. */
  requestedBy?: string;
  threadId?: string;
  runId?: string;
  createdAt?: string;
  id: string;
};

export type RunLike = { id: string; threadId?: string };

export type ConversationTabLike = { type: "agent" | "channel"; id: string };

function requestingMemberId(approval: PendingApprovalLike): string | undefined {
  return approval.requestedByMemberId ?? approval.requestedBy;
}

/**
 * Keep at most one pending approval visible per run/thread queue.
 * Resolved approvals remain visible; pending approvals are serialized in order.
 */
export function queueApprovals<T extends PendingApprovalLike>(approvals: T[]): T[] {
  const pendingSeen = new Set<string>();
  return [...approvals]
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id))
    .filter((approval) => {
      if (approval.status !== "pending") return true;
      const queueId = approval.runId ?? approval.threadId ?? approval.id;
      if (pendingSeen.has(queueId)) return false;
      pendingSeen.add(queueId);
      return true;
    });
}

/** Mirrors `pendingThreadApprovals` in channel-view. */
export function pendingApprovalVisibleInChannelView(
  approval: PendingApprovalLike,
  conversation: ConversationTabLike,
  currentThreadId: string | undefined,
  runs: RunLike[],
): boolean {
  if (approval.status !== "pending") return false;
  if (conversation.type === "agent") {
    const requesterId = requestingMemberId(approval);
    if (!requesterId || requesterId !== conversation.id) return false;
    if (approval.threadId && currentThreadId && approval.threadId !== currentThreadId) {
      return false;
    }
    if (approval.threadId && currentThreadId && approval.threadId === currentThreadId) {
      return true;
    }
    if (approval.runId && currentThreadId) {
      const run = runs.find((r) => r.id === approval.runId);
      if (run?.threadId) return run.threadId === currentThreadId;
    }
    return true;
  }
  if (!currentThreadId) return false;
  if (approval.threadId) return approval.threadId === currentThreadId;
  if (!approval.runId) return false;
  const run = runs.find((r) => r.id === approval.runId);
  if (!run?.threadId) return false;
  return run.threadId === currentThreadId;
}
