"use client";

import { useState } from "react";
import { Check, FileText, Loader2, ShieldAlert, X } from "lucide-react";
import { NODE_STATUS_STYLES } from "./nodes";
import {
  getWorkflowRunArtifact,
  resolveBlockingApproval,
  type WorkflowBlockingApproval,
  type WorkflowNodeRunView,
  type WorkflowRunArtifact,
  type WorkflowRunDetail,
} from "./use-workflows";

function approvalLabel(a: WorkflowBlockingApproval): string {
  const base = a.resourcePath.split("/").filter(Boolean).pop() ?? a.resourcePath;
  if (a.resourceType === "file") return `${a.action} the file ${base}`;
  if (a.resourceType === "mcp") return `run the MCP tool ${a.resourcePath}`;
  if (a.resourceType === "shell") return `run a shell command`;
  return `${a.action} ${base}`;
}

function latestByNode(nodeRuns: WorkflowNodeRunView[]): WorkflowNodeRunView[] {
  const map = new Map<string, WorkflowNodeRunView>();
  for (const nr of nodeRuns) {
    const prev = map.get(nr.nodeId);
    if (!prev || nr.attempt >= prev.attempt) map.set(nr.nodeId, nr);
  }
  return [...map.values()].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
}

const KIND_LABEL: Record<string, string> = {
  trigger: "Trigger",
  agent: "Agent",
  approval: "Approval",
  goal_handoff: "Goal",
  skill: "Skill",
  tool: "Tool",
};

function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDuration(a?: string | null, b?: string | null): string {
  if (!a || !b) return "";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * The non-canvas run detail: ordered Steps (each with a link to view its produced
 * artifact) and the run-thread Conversation. Shared by the full-page run view and
 * the in-channel run drawer.
 */
export function WorkflowRunSidePanel({
  runId,
  detail,
  onReload,
}: {
  runId: string;
  detail: WorkflowRunDetail;
  onReload?: () => void;
}) {
  const steps = latestByNode(detail.nodeRuns);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<WorkflowRunArtifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function resolveApproval(id: string, resolution: "allow_once" | "reject") {
    setResolvingId(id);
    try {
      await resolveBlockingApproval(id, detail.run.organizationId, resolution);
      onReload?.();
    } catch {
      // leave it; the poll will refresh
    } finally {
      setResolvingId(null);
    }
  }

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
      {detail.blockingApprovals.length > 0 && (
        <div className="shrink-0 space-y-2 border-b border-amber-200 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            <ShieldAlert className="h-3.5 w-3.5" /> Waiting for approval
          </div>
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
                  onClick={() => void resolveApproval(a.id, "reject")}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-red-300 px-2 py-1.5 font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-500/40 dark:hover:bg-red-500/10"
                >
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
                <button
                  type="button"
                  disabled={resolvingId === a.id}
                  onClick={() => void resolveApproval(a.id, "allow_once")}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-2 py-1.5 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                >
                  {resolvingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="shrink-0 space-y-2 overflow-y-auto p-3" style={{ maxHeight: "55%" }}>
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Timeline</p>
        {steps.length === 0 ? (
          <p className="px-1 text-xs text-zinc-400">No steps yet.</p>
        ) : (
          steps.map((nr) => {
            const s = NODE_STATUS_STYLES[nr.status];
            const isOpen = openPath === nr.outputPath;
            const timing = [fmtTime(nr.startedAt), fmtDuration(nr.startedAt, nr.completedAt)]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={nr.id} className="rounded-lg border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                  <span className="truncate font-semibold text-zinc-800 dark:text-zinc-200">
                    {nr.agentName ?? nr.nodeId}
                  </span>
                  <span className="shrink-0 rounded bg-zinc-100 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {KIND_LABEL[nr.kind] ?? nr.kind}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase text-zinc-400">{s.label}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-zinc-400">
                  {nr.agentName && nr.nodeId !== nr.agentName && <span className="truncate">{nr.nodeId}</span>}
                  {timing && <span className="ml-auto shrink-0">{timing}</span>}
                </div>
                {nr.summary && <p className="mt-1 text-zinc-600 dark:text-zinc-400">{nr.summary}</p>}
                {nr.toolSteps && nr.toolSteps.length > 0 && (
                  <div className="mt-1.5 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
                    {nr.toolSteps.map((s, i) => (
                      <div key={i} className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                        <span
                          className={
                            s.status === "error"
                              ? "text-red-500"
                              : s.status === "pending"
                                ? "text-amber-500"
                                : "text-emerald-500"
                          }
                        >
                          ●
                        </span>
                        <span className="font-semibold text-zinc-600 dark:text-zinc-300">{s.tool}</span>
                        {s.resourcePath && <span className="min-w-0 truncate">{s.resourcePath}</span>}
                      </div>
                    ))}
                  </div>
                )}
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
          Agent activity
        </p>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          {detail.messages.length === 0 ? (
            <p className="px-1 text-xs text-zinc-400">
              {steps.some((nr) => nr.kind === "agent")
                ? "No agent messages yet."
                : "This workflow has no agent steps — nothing to show here."}
            </p>
          ) : (
            detail.messages.map((m) => (
              <div key={m.id} className="rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-900/60">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">{m.senderName}</span>
                  {m.createdAt && (
                    <span className="font-mono text-[10px] text-zinc-400">{fmtTime(m.createdAt)}</span>
                  )}
                </div>
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
