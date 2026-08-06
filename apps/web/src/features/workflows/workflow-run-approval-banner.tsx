"use client";

import { useState } from "react";
import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import {
  resolveBlockingApproval,
  type WorkflowBlockingApproval,
  type WorkflowRunDetail,
} from "./use-workflows";

function approvalLabel(a: WorkflowBlockingApproval): string {
  const base = a.resourcePath.split("/").filter(Boolean).pop() ?? a.resourcePath;
  if (a.resourceType === "file") return `${a.action} the file ${base}`;
  if (a.resourceType === "mcp") return `run the MCP tool ${a.resourcePath.split(":").pop() ?? a.resourcePath}`;
  if (a.resourceType === "shell") return "run a shell command";
  return `${a.action} ${base}`;
}

/**
 * Actionable banner for tool approvals blocking a run's agent step. Shown above
 * the run tabs so it's visible whichever tab you're on.
 */
export function WorkflowRunApprovalBanner({
  detail,
  onReload,
}: {
  detail: WorkflowRunDetail;
  onReload?: () => void;
}) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (detail.blockingApprovals.length === 0) return null;

  async function resolve(id: string, resolution: "allow_once" | "reject") {
    setResolvingId(id);
    setError(null);
    try {
      await resolveBlockingApproval(id, detail.run.organizationId, resolution);
      onReload?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resolve approval.");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="shrink-0 space-y-2 border-b border-amber-200 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <ShieldAlert className="h-3.5 w-3.5" /> Waiting for approval
      </div>
      {error ? <p className="px-1 text-xs text-red-600 dark:text-red-300">{error}</p> : null}
      {detail.blockingApprovals.map((a) => (
        <div
          key={a.id}
          className="rounded-lg border border-amber-200 bg-white p-2.5 text-xs dark:border-amber-500/20 dark:bg-zinc-900"
        >
          <p className="text-zinc-700 dark:text-zinc-300">
            <span className="font-semibold">{a.agentName ?? a.nodeId}</span> wants to {approvalLabel(a)}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-400">{a.resourcePath}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={resolvingId === a.id}
              onClick={() => void resolve(a.id, "reject")}
              className="flex items-center justify-center gap-1.5 rounded-md border border-red-300 px-2 py-1.5 font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-500/40 dark:hover:bg-red-500/10"
            >
              <X className="h-3.5 w-3.5" /> Reject
            </button>
            <button
              type="button"
              disabled={resolvingId === a.id}
              onClick={() => void resolve(a.id, "allow_once")}
              className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-2 py-1.5 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {resolvingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Approve
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
