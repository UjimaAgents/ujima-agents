import { memo } from "react";
import type { RunState } from "@ujima/shared/browser";
import { StatusBadge, type StatusVariant } from "./chat/primitives";

function runStatusVariant(status: RunState["status"]): StatusVariant {
  switch (status) {
    case "completed":
      return "active";
    case "running":
      return "active";
    case "waiting_for_approval":
      return "idle";
    case "failed":
    case "cancelled":
      return "error";
    default:
      return "idle";
  }
}

export const RunCard = memo(function RunCard({ run, blockedReason }: { run: RunState; blockedReason?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-zinc-900 dark:text-white">
            {run.summary || "Run"}
          </p>
          <p className="text-xs text-zinc-500">
            {run.step || run.status.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")} · {run.agentId}
          </p>
          {blockedReason ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              Blocked: {blockedReason}
            </p>
          ) : null}
        </div>
        <StatusBadge variant={runStatusVariant(run.status)} label={run.status} />
      </div>
    </div>
  );
});
