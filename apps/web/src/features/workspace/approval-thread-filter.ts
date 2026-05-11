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
};

export type RunLike = { id: string; threadId?: string };

export type ConversationTabLike = { type: "agent" | "channel"; id: string };

function requestingMemberId(approval: PendingApprovalLike): string | undefined {
  return approval.requestedByMemberId ?? approval.requestedBy;
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
