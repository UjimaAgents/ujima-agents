"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { getWorkflowRunArtifact, type WorkflowRunArtifact, type WorkflowRunDetail } from "./use-workflows";

/** Every file the run's steps produced, each viewable inline. */
export function WorkflowRunArtifacts({ runId, detail }: { runId: string; detail: WorkflowRunDetail }) {
  const seen = new Set<string>();
  const files = detail.nodeRuns
    .filter((nr): nr is typeof nr & { outputPath: string } => Boolean(nr.outputPath))
    .filter((nr) => (seen.has(nr.outputPath) ? false : (seen.add(nr.outputPath), true)))
    .map((nr) => ({ path: nr.outputPath, by: nr.agentName ?? nr.nodeId }));

  const [openPath, setOpenPath] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<WorkflowRunArtifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(path: string) {
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

  if (files.length === 0) {
    return <p className="p-4 text-xs text-zinc-400">No artifacts produced yet.</p>;
  }

  return (
    <div className="space-y-2 overflow-y-auto p-3">
      {files.map((f) => {
        const isOpen = openPath === f.path;
        const name = f.path.split("/").filter(Boolean).pop() ?? f.path;
        return (
          <div key={f.path} className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => void toggle(f.path)}
              className="flex w-full items-center gap-2 text-left"
            >
              <FileText className="h-4 w-4 shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">{name}</p>
                <p className="truncate font-mono text-[10px] text-zinc-400">{f.path}</p>
              </div>
              <span className="shrink-0 text-[11px] font-medium text-violet-600 dark:text-violet-300">
                {isOpen ? "Hide" : "View"}
              </span>
            </button>
            {isOpen && (
              <div className="mt-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-900/60">
                {loading ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                  </div>
                ) : error ? (
                  <p className="text-[11px] text-red-500">{error}</p>
                ) : artifact ? (
                  <>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
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
          </div>
        );
      })}
    </div>
  );
}
