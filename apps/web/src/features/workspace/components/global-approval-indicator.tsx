import { useCallback, useMemo, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { ApprovalQueue } from "./chat";
import { useWorkspaceStore } from "../workspace-store";
import { resolveWorkspaceApproval } from "../approval-resolution";
import { queueApprovals } from "../approval-thread-filter";
import { approvalToActivity } from "../activity-events";
import { approvalToCard } from "../approval-card-data";
import { ApprovalRequestSchema } from "@ujima/shared/browser";

type Resolution = "allow_once" | "allow_always" | "allow_family" | "reject";

/**
 * Floating, workspace-wide approval indicator. Counts pending approvals across
 * every channel/DM (not just the open conversation) and surfaces them in the
 * same one-at-a-time `<ApprovalQueue>` used by the Approvals tab. Hidden when
 * nothing is pending. Mounted once at the shell so an operator can clear
 * approvals without hunting through conversations.
 */
export function GlobalApprovalIndicator({ organizationId }: { organizationId: string }) {
  const approvals = useWorkspaceStore((state) => state.approvals);
  const upsertApproval = useWorkspaceStore((state) => state.upsertApproval);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pending = useMemo(
    () => queueApprovals(approvals.filter((approval) => approval.status === "pending")),
    [approvals],
  );

  const onResolve = useCallback(
    async (approvalId: string, resolution: Resolution) => {
      setResolving((state) => ({ ...state, [approvalId]: true }));
      setErrors((state) => {
        const next = { ...state };
        delete next[approvalId];
        return next;
      });
      try {
        const response = await resolveWorkspaceApproval({ organizationId, approvalId, resolution });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const message =
            body && typeof body === "object" && "message" in body && typeof body.message === "string"
              ? body.message
              : "Unable to resolve approval.";
          setErrors((state) => ({ ...state, [approvalId]: message }));
          return;
        }
        const body = await response.json().catch(() => null);
        const parsed = ApprovalRequestSchema.safeParse(body);
        if (parsed.success) {
          upsertApproval(
            parsed.data,
            (value, state) => approvalToCard(value, { members: state.members }),
            approvalToActivity,
          );
        }
      } finally {
        setResolving((state) => {
          const next = { ...state };
          delete next[approvalId];
          return next;
        });
      }
    },
    [organizationId, upsertApproval],
  );

  if (pending.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open ? (
        <div className="w-[min(92vw,28rem)] rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              <ShieldAlert className="h-3.5 w-3.5 text-violet-500" />
              Pending approvals
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              aria-label="Close approvals"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ApprovalQueue
            approvals={pending}
            resolving={resolving}
            errors={errors}
            onResolve={onResolve}
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-violet-600 pl-3.5 pr-4 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:bg-violet-700"
      >
        <ShieldAlert className="h-4 w-4" />
        {pending.length} pending
      </button>
    </div>
  );
}
