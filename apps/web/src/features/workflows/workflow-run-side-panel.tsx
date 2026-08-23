"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { NODE_STATUS_STYLES } from "./nodes";
import {
  getWorkflowRunArtifact,
  type WorkflowNodeRunView,
  type WorkflowRunArtifact,
  type WorkflowRunDetail,
  type WorkflowRunMessage,
  type WorkflowToolStep,
} from "./use-workflows";

/** A single agent-activity entry — agent narration shown; long system prompts collapse. */
function ActivityMessage({ m }: { m: WorkflowRunMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isSystem = m.senderKind !== "agent";
  const long = m.content.length > 220;
  const shown = expanded || !long ? m.content : `${m.content.slice(0, 220)}…`;
  return (
    <div
      className={`rounded-lg p-2 text-xs ${
        isSystem ? "bg-zinc-50/60 dark:bg-zinc-900/40" : "bg-zinc-50 dark:bg-zinc-900/60"
      }`}
    >
      <div className="flex items-baseline gap-1.5">
        <span
          className={`font-semibold ${
            isSystem ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-700 dark:text-zinc-300"
          }`}
        >
          {isSystem ? "Instructions" : m.senderName}
        </span>
        {m.createdAt && <span className="font-mono text-[10px] text-zinc-400">{fmtTime(m.createdAt)}</span>}
      </div>
      <p
        className={`mt-0.5 whitespace-pre-wrap break-words ${
          isSystem ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-600 dark:text-zinc-300"
        }`}
      >
        {shown}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-[10px] font-medium text-violet-600 hover:underline dark:text-violet-300"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** Friendly tool name — MCP steps carry "serverId:toolName" in resourcePath. */
function toolLabel(step: WorkflowToolStep): string {
  if (step.tool === "mcp" && step.resourcePath) return step.resourcePath.split(":").pop() ?? step.tool;
  return step.tool;
}

interface ToolGroup {
  label: string;
  count: number;
  error: boolean;
  sample?: string;
}

/** Collapse a long tool-call list into compact per-tool groups with counts. */
function groupToolSteps(steps: WorkflowToolStep[]): ToolGroup[] {
  const map = new Map<string, ToolGroup>();
  for (const s of steps) {
    const label = toolLabel(s);
    const g = map.get(label) ?? { label, count: 0, error: false };
    g.count += 1;
    if (s.status === "error") g.error = true;
    if (!g.sample && s.resourcePath && /write|view|read|edit/.test(s.action)) {
      g.sample = s.resourcePath.split("/").filter(Boolean).pop();
    }
    map.set(label, g);
  }
  return [...map.values()];
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
      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto p-3">
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
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {groupToolSteps(nr.toolSteps).map((g) => (
                      <span
                        key={g.label}
                        title={g.sample}
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                          g.error
                            ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {g.label}
                        {g.sample ? <span className="text-zinc-400">{g.sample}</span> : null}
                        {g.count > 1 ? <span className="font-sans font-semibold text-zinc-400">×{g.count}</span> : null}
                      </span>
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
                {(nr.failureDetail || nr.failureReason) && (
                  <p className="mt-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] leading-snug text-red-600 dark:bg-red-500/10 dark:text-red-300">
                    {nr.failureDetail ?? nr.failureReason}
                  </p>
                )}
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
            detail.messages.map((m) => <ActivityMessage key={m.id} m={m} />)
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
