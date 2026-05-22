import { isDirectMessageThread } from "@ujima/shared/browser";

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
  return approvals
    .map((approval, index) => ({ approval, index }))
    .sort((left, right) => {
      const leftTime = left.approval.createdAt ? Date.parse(left.approval.createdAt) : Number.POSITIVE_INFINITY;
      const rightTime = right.approval.createdAt ? Date.parse(right.approval.createdAt) : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.index - right.index;
    })
    .filter(({ approval }) => {
      if (approval.status !== "pending") return true;
      const queueId = approval.runId ?? approval.threadId ?? approval.id;
      if (pendingSeen.has(queueId)) return false;
      pendingSeen.add(queueId);
      return true;
    })
    .map(({ approval }) => approval);
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
    // Approval scoped to a different DM thread than the tab we're viewing — hide (another inbox).
    if (
      isDirectMessageThread(approval.threadId) &&
      currentThreadId &&
      approval.threadId !== currentThreadId
    ) {
      return false;
    }
    if (approval.threadId && currentThreadId && approval.threadId === currentThreadId) {
      return true;
    }
    if (approval.runId && currentThreadId) {
      const run = runs.find((r) => r.id === approval.runId);
      if (run?.threadId) {
        if (run.threadId === currentThreadId) return true;
        // Same agent, run tied to another person's DM — hide from this DM tab.
        if (isDirectMessageThread(run.threadId)) return false;
        // Run on a channel/task thread — owner still reviews from this agent's DM.
        return true;
      }
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
