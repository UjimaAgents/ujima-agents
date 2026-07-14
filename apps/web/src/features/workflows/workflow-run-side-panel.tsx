"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { WorkflowNodeRun } from "@ujima/shared";
import { NODE_STATUS_STYLES } from "./nodes";
import { getWorkflowRunArtifact, type WorkflowRunArtifact, type WorkflowRunDetail } from "./use-workflows";

function latestByNode(nodeRuns: WorkflowNodeRun[]): WorkflowNodeRun[] {
  const map = new Map<string, WorkflowNodeRun>();
  for (const nr of nodeRuns) {
    const prev = map.get(nr.nodeId);
    if (!prev || nr.attempt >= prev.attempt) map.set(nr.nodeId, nr);
  }
  return [...map.values()].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
}

/**
 * The non-canvas run detail: ordered Steps (each with a link to view its produced
 * artifact) and the run-thread Conversation. Shared by the full-page run view and
 * the in-channel run drawer.
 */
export function WorkflowRunSidePanel({
  runId,
  detail,
}: {
  runId: string;
  detail: WorkflowRunDetail;
}) {
  const steps = latestByNode(detail.nodeRuns);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<WorkflowRunArtifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleArtifact(path: string) {
    if (openPath === path) {
      setOpenPath(null);
      setArtifact(null);
      setError(null);
      return;
    }
    setOpenPath(path);
    setArtifact(null);
    setError(null);
    setLoading(true);
    try {
      setArtifact(await getWorkflowRunArtifact(runId, path));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load file.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="shrink-0 space-y-2 overflow-y-auto p-3" style={{ maxHeight: "55%" }}>
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Steps</p>
        {steps.length === 0 ? (
          <p className="px-1 text-xs text-zinc-400">No steps yet.</p>
        ) : (
          steps.map((nr) => {
            const s = NODE_STATUS_STYLES[nr.status];
            const isOpen = openPath === nr.outputPath;
            return (
              <div key={nr.id} className="rounded-lg border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">{nr.nodeId}</span>
                  <span className="ml-auto text-[10px] uppercase text-zinc-400">{s.label}</span>
                </div>
                {nr.summary && <p className="mt-1 text-zinc-600 dark:text-zinc-400">{nr.summary}</p>}
                {nr.outputPath && (
                  <button
                    type="button"
                    onClick={() => void toggleArtifact(nr.outputPath!)}
                    className="mt-1.5 flex w-full items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-left font-mono text-[10px] text-zinc-500 transition hover:border-violet-300 hover:text-violet-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-violet-500/40 dark:hover:text-violet-300"
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{nr.outputPath}</span>
                    <span className="shrink-0 font-sans font-medium">{isOpen ? "Hide" : "View"}</span>
                  </button>
                )}
                {isOpen && (
                  <div className="mt-1.5 rounded-md bg-zinc-50 p-2 dark:bg-zinc-900/60">
                    {loading ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                      </div>
                    ) : error ? (
                      <p className="text-[11px] text-red-500">{error}</p>
                    ) : artifact ? (
                      <>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                          {artifact.content}
                        </pre>
                        {artifact.truncated && (
                          <p className="mt-1 text-[10px] italic text-zinc-400">
                            Truncated — {(artifact.sizeBytes / 1024).toFixed(0)} KB total.
                          </p>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
                {nr.failureReason && <p className="mt-1 text-red-500">{nr.failureReason}</p>}
              </div>
            );
          })
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-200 dark:border-zinc-800">
        <p className="shrink-0 px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Conversation
        </p>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          {detail.messages.length === 0 ? (
            <p className="px-1 text-xs text-zinc-400">No messages yet.</p>
          ) : (
            detail.messages.map((m) => (
              <div key={m.id} className="rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-900/60">
                <p className="font-semibold text-zinc-700 dark:text-zinc-300">{m.senderName}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-zinc-600 dark:text-zinc-400">
                  {m.content.length > 600 ? `${m.content.slice(0, 600)}…` : m.content}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

/** Shared action buttons for a run (approve/reject/retry/skip/abort). */
export function WorkflowRunControls({
  status,
  busy,
  onAct,
}: {
  status: WorkflowRunDetail["run"]["status"];
  busy: boolean;
  onAct: (action: "approve" | "reject" | "retry" | "skip" | "abort") => void;
}) {
  const controls =
    status === "awaiting_approval"
      ? (["approve", "reject"] as const)
      : status === "paused"
        ? (["retry", "skip", "abort"] as const)
        : [];
  if (controls.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      {controls.map((action) => (
        <button
          key={action}
          type="button"
          disabled={busy}
          onClick={() => onAct(action)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
            action === "approve"
              ? "bg-emerald-600 text-white hover:bg-emerald-500"
              : action === "reject" || action === "abort"
                ? "border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:hover:bg-red-500/10"
                : "border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {action}
        </button>
      ))}
    </div>
  );
}
