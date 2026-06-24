import { memo } from "react";
import { Layers } from "lucide-react";
import { ApprovalCard, type ApprovalCardData } from "./approval-card";

type Resolution = "allow_once" | "allow_always" | "allow_family" | "reject";

/**
 * Serializes pending approvals into a one-at-a-time queue: a header counter
 * ("1 of N") plus the single oldest pending approval. As each is resolved it
 * drops out of `approvals` (recomputed by the parent) and the next one
 * surfaces automatically — so there is no index state to track here.
 *
 * Replaces the old "render every pending card in a vertical stack" layout,
 * which buried later approvals and made multi-agent runs hard to clear.
 */
export const ApprovalQueue = memo(function ApprovalQueue({
  approvals,
  resolving = {},
  errors = {},
  onResolve,
}: {
  approvals: ApprovalCardData[];
  resolving?: Record<string, boolean>;
  errors?: Record<string, string>;
  onResolve?: (approvalId: string, resolution: Resolution) => void;
}) {
  const [current, ...rest] = approvals;
  if (!current) return null;

  return (
    <div className="space-y-2">
      {approvals.length > 1 ? (
        <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
          <span className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-violet-500" />
            Approval 1 of {approvals.length}
          </span>
          <span className="text-zinc-400">{rest.length} more queued</span>
        </div>
      ) : null}
      <ApprovalCard
        key={current.id}
        data={{ ...current, error: errors[current.id] }}
        resolving={!!resolving[current.id]}
        onResolve={onResolve}
      />
    </div>
  );
});
