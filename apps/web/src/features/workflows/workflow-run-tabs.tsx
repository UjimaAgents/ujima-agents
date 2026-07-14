"use client";

import { useState } from "react";
import { FileText, GitBranch, ListTree, type LucideIcon } from "lucide-react";
import type { WorkflowRunDetail } from "./use-workflows";
import { WorkflowRunApprovalBanner } from "./workflow-run-approval-banner";
import { WorkflowRunCanvas } from "./workflow-run-canvas";
import { WorkflowRunSidePanel } from "./workflow-run-side-panel";
import { WorkflowRunArtifacts } from "./workflow-run-artifacts";

type Tab = "canvas" | "trace" | "artifacts";

/**
 * Tabbed run view for the in-channel drawer: the live graph (current step
 * highlighted), the execution trace + agent activity, and the artifacts.
 */
export function WorkflowRunTabs({
  runId,
  detail,
  onReload,
}: {
  runId: string;
  detail: WorkflowRunDetail;
  onReload?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("canvas");
  const artifactCount = new Set(
    detail.nodeRuns.filter((n) => n.outputPath).map((n) => n.outputPath),
  ).size;

  const tabs: { id: Tab; label: string; icon: LucideIcon; badge?: number }[] = [
    { id: "canvas", label: "Canvas", icon: GitBranch },
    { id: "trace", label: "Trace", icon: ListTree },
    { id: "artifacts", label: "Artifacts", icon: FileText, badge: artifactCount },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkflowRunApprovalBanner detail={detail} onReload={onReload} />
      <div className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-xs font-medium transition ${
                active
                  ? "border-violet-500 text-violet-600 dark:text-violet-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.badge ? (
                <span className="rounded-full bg-zinc-100 px-1 text-[9px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "canvas" ? (
          <WorkflowRunCanvas detail={detail} />
        ) : tab === "trace" ? (
          <div className="flex h-full flex-col">
            <WorkflowRunSidePanel runId={runId} detail={detail} />
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <WorkflowRunArtifacts runId={runId} detail={detail} />
          </div>
        )}
      </div>
    </div>
  );
}
