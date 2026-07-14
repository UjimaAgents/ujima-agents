"use client";

import { useState } from "react";
import { Check, Loader2, ShieldAlert, SquareArrowOutUpRight, X } from "lucide-react";
import type { MessageCard } from "@ujima/shared/browser";
import { transitionWorkflowRun } from "./use-workflows";

type WorkflowApprovalCard = Extract<MessageCard, { kind: "workflow.approval" }>;

/**
 * Renders a workflow approval gate as an interactive card in the channel — the
 * operator approves or rejects inline (like an MCP action approval) and the run
 * advances via the transition endpoint. "Open run" opens the run drawer for the
 * full context (steps, artifacts, conversation).
 */
export function WorkflowApprovalCardView({
  card,
  onOpenRun,
}: {
  card: WorkflowApprovalCard;
  onOpenRun?: (runId: string) => void;
}) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">(card.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(action: "approve" | "reject") {
    let reason: string | undefined;
    if (action === "reject") {
      reason = window.prompt("Reason for rejection?") ?? undefined;
    }
    setBusy(true);
    setError(null);
    try {
      await transitionWorkflowRun(card.workflowRunId, action, reason);
      setStatus(action === "approve" ? "approved" : "rejected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const resolved = status !== "pending";

  return (
    <div className="w-full rounded-xl border border-violet-300/60 bg-violet-50/40 p-3 dark:border-violet-500/30 dark:bg-violet-500/5">
      <div className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-300">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Approval needed</p>
            <span className="truncate rounded-full bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-600 dark:text-violet-300">
              {card.workflowName} · {card.nodeId}
            </span>
          </div>
          {card.prompt && (
            <p className="mt-1 text-sm leading-6 text-zinc-700 dark:text-zinc-300">{card.prompt}</p>
          )}
          {card.priorSummary && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-medium">Previous step:</span> {card.priorSummary}
            </p>
          )}
          {card.priorOutputPath && onOpenRun && (
            <button
              type="button"
              onClick={() => onOpenRun(card.workflowRunId)}
              className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 underline-offset-2 transition hover:text-violet-600 hover:underline dark:text-zinc-400 dark:hover:text-violet-300"
            >
              <SquareArrowOutUpRight className="h-3 w-3" />
              {card.priorOutputPath}
            </button>
          )}
          {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
        </div>
      </div>

      {resolved ? (
        <div className="mt-2.5 flex items-center justify-between">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              status === "approved"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
            }`}
          >
            {status === "approved" ? "Approved" : "Rejected"}
          </span>
          {onOpenRun && (
            <button
              type="button"
              onClick={() => onOpenRun(card.workflowRunId)}
              className="text-[11px] font-medium text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
            >
              Open run →
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void resolve("reject")}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-500/40 dark:hover:bg-red-500/10"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void resolve("approve")}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve
          </button>
        </div>
      )}
    </div>
  );
}
