import { memo } from "react";
import { CheckCircle2, X } from "lucide-react";
import { TERMINAL_PANEL, TERMINAL_SECTION } from "./terminal-chrome";
import { TerminalPane } from "./terminal-pane";
import { BackgroundShellJobPane } from "./background-shell-job-pane";
import { FilesystemToolPane } from "./filesystem-tool-pane";
import { GrepToolPane } from "./grep-tool-pane";
import { WebSearchToolPane } from "./web-search-tool-pane";
import { SkillReadPane } from "./skill-read-pane";
import { UnifiedDiffView } from "./unified-diff-view";
import { AggregatedRunPanel, SemanticToolPane, ToolCallIcon, TraceMarkdown } from "./aggregated-run-panel";
import { collectFileChanges } from "../../change-summary";
import type { AggregatedOperation, TraceStepData } from "./trace-types";

export type { TraceStepData } from "./trace-types";
export const TraceStep = memo(function TraceStep({
  step,
  isLast,
  autoOpen,
}: {
  step: TraceStepData;
  /** Hide the connector below the dot on the final row. */
  isLast?: boolean;
  autoOpen?: boolean;
}) {
  const {subject, remainder} = splitTraceTitle(step.title);
  const isUnifiedRun = Boolean(step.aggregatedOperations?.length);
  const markerType = isUnifiedRun
    ? step.aggregatedOperations?.[0]?.type ?? "tool"
    : getTraceOperationType(step);
  const rowMargin = step.title.startsWith("Run ·") ? "mt-2" : "";
  const rowPadding = isLast ? "pb-0" : "pb-4";
  const body = step.aggregatedOperations && step.aggregatedOperations.length > 0 ? (
    <AggregatedRunPanel
      operations={step.aggregatedOperations}
      actorName={step.actorName}
      autoOpen={Boolean(autoOpen || (isLast && step.status === "running"))}
    />
  ) : step.terminal?.streamingJob ? (
    <BackgroundShellJobPane
      cwd={step.terminal.cwd}
      commandLine={step.terminal.commandLine}
      runId={step.terminal.streamingJob.runId}
      jobId={step.terminal.streamingJob.jobId}
      organizationId={step.terminal.streamingJob.organizationId}
    />
  ) : step.terminal ? (
    <TerminalPane
      cwd={step.terminal.cwd}
      commandLine={step.terminal.commandLine}
      output={step.terminal.output}
      outputPlaceholder={step.terminal.outputPlaceholder}
      outputTone={step.terminal.outputTone}
    />
  ) : step.filesystem ? (
    <FilesystemToolPane
      action={step.filesystem.action}
      resourcePath={step.filesystem.resourcePath}
      meta={step.filesystem.meta}
      body={step.filesystem.body}
      bodyTone={step.filesystem.bodyTone}
    />
  ) : step.grep ? (
    <GrepToolPane
      query={step.grep.query}
      path={step.grep.path}
      count={step.grep.count}
      limit={step.grep.limit}
      truncated={step.grep.truncated}
      matches={step.grep.matches}
    />
  ) : step.webSearch ? (
    <WebSearchToolPane
      query={step.webSearch.query}
      site={step.webSearch.site}
      status={step.webSearch.status}
      source={step.webSearch.source}
      results={step.webSearch.results}
    />
  ) : step.skillRead ? (
    <SkillReadPane
      skillName={step.skillRead.skillName}
      pluginName={step.skillRead.pluginName}
      description={step.skillRead.description}
      output={step.skillRead.output}
      status={step.status}
    />
  ) : step.toolName?.startsWith("memory.") || step.toolName?.startsWith("channel.") || step.toolName === "message" ? (
    <SemanticToolPane
      op={{
        id: step.id,
        type: step.toolName.startsWith("memory.") ? "memory" : "message",
        additions: 0,
        deletions: 0,
        status: step.status,
        toolName: step.toolName,
        toolInput: step.toolInput,
        toolResult: step.toolResult,
        detail: step.detail,
      }}
    />
  ) : step.detail.trim() ? (
    <TraceMarkdown content={step.detail} tone="text-foreground/75" />
  ) : null;

  return (
    <div
      className={`relative pl-6 ${rowMargin} ${rowPadding}`}
    >
      <span
        className="pointer-events-none z-[2] flex h-5 w-5 items-center justify-center rounded-sm bg-background text-foreground/45"
        style={{ position: "absolute", left: -6, top: 2 }}
        aria-hidden="true"
      >
        <ToolCallIcon type={markerType} className="h-3.5 w-3.5" />
      </span>
      {!isLast ? (
        <div
          className="absolute bottom-0 left-1 top-5 w-px bg-zinc-300 dark:bg-zinc-700"
          aria-hidden
        />
      ) : null}

      <div className="min-w-0">
        {isUnifiedRun ? body : (
          <>
            <div className="flex min-h-5 items-baseline justify-between gap-3">
              <div className="min-w-0 flex flex-1 flex-wrap items-baseline gap-x-2 gap-y-0">
                <p className="min-w-0 text-xs leading-snug text-foreground trace-step-title">
                  <span className="font-semibold">{subject}</span>
                  {remainder ? <span className="font-normal">{remainder}</span> : null}
                </p>
              </div>
              <div className="flex shrink-0 items-baseline gap-2.5 whitespace-nowrap text-[11px] tabular-nums leading-snug text-foreground/45">
                <span>{step.time}</span>
                {step.duration && !["—", "0ms", "0s", "0"].includes(step.duration.trim()) && (
                  <span className="min-w-[4ch] text-end">{step.duration}</span>
                )}
              </div>
            </div>
            {step.reasoning ? (
              <details className="mt-2" open={step.status === "running"}>
                <summary className="cursor-pointer list-none text-[11px] leading-snug text-foreground/45">
                  Thinking
                </summary>
                <TraceMarkdown content={step.reasoning} tone="text-foreground/60" />
              </details>
            ) : null}
            {body ? <div className="mt-2">{body}</div> : null}
            {step.subtext ? (
              <p className="mt-2 text-[11px] leading-snug text-foreground/45">{step.subtext}</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
});

function getTraceOperationType(step: TraceStepData): AggregatedOperation["type"] {
  if (step.filesystem) {
    return step.filesystem.action === "write" ? "edit" : "read";
  }
  if (step.grep || step.webSearch) return "search";
  if (step.terminal) return "shell";
  if (step.skillRead) return "skill";
  const toolName = step.toolName ?? "";
  if (toolName.startsWith("memory.")) return "memory";
  if (toolName.startsWith("goal.")) return "goal";
  if (toolName.startsWith("question.")) return "question";
  if (toolName.startsWith("self.procedure.")) return "procedure";
  if (toolName === "schedule") return "schedule";
  if (toolName === "agent.delegate") return "delegate";
  if (toolName === "message" || toolName.startsWith("channel.")) return "message";
  return "tool";
}

function splitTraceTitle(title: string): {subject: string; remainder: string} {
  const trimmed = title.trim();
  if (!trimmed) return {subject: "", remainder: ""};

  const separators = [
    " sent a message ",
    " sent a DM",
    " responded to ",
    " replied ",
    " called tool ",
    " used ",
    " updated ",
    " posted ",
    " created ",
    " ran ",
    " finished ",
  ];

  for (const separator of separators) {
    const index = trimmed.indexOf(separator);
    if (index > 0) {
      return {
        subject: trimmed.slice(0, index),
        remainder: trimmed.slice(index),
      };
    }
  }

  const dotIndex = trimmed.indexOf(" · ");
  if (dotIndex > 0) {
    return {
      subject: trimmed.slice(0, dotIndex),
      remainder: trimmed.slice(dotIndex),
    };
  }

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex > 0) {
    return {
      subject: trimmed.slice(0, spaceIndex),
      remainder: trimmed.slice(spaceIndex),
    };
  }

  return {subject: trimmed, remainder: ""};
}

/* ── Run summary card ──────────────────────────────────────────────── */
export interface RunSummaryData {
  files: {name: string; additions: number; deletions: number}[];
  tokens: string;
  duration: string;
}

export function RunSummary({data}: {data: RunSummaryData}) {
  return (
    <div className={TERMINAL_PANEL}>
      <div
        className={`${TERMINAL_SECTION} flex items-center justify-between px-3 py-2`}
      >
        <p className="text-[9px] font-semibold uppercase tracking-wider text-foreground/45">
          Files touched
        </p>
        <p className="text-[9px] font-semibold uppercase tracking-wider text-foreground/45">
          Run summary
        </p>
      </div>
      <div className="flex gap-3 px-3 py-2">
        <div className="flex-1 space-y-0.5">
          {data.files.map((f) => (
            <div
              key={f.name}
              className="flex items-center justify-between text-[10px]"
            >
              <span className="text-foreground/70">{f.name}</span>
              <span className="text-emerald-600/90 dark:text-emerald-400/90">
                +{f.additions} -{f.deletions}
              </span>
            </div>
          ))}
        </div>
        <div className="w-px shrink-0 bg-foreground/10" />
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-foreground/55">Tokens</span>
            <span className="font-semibold text-foreground">{data.tokens}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-foreground/55">Duration</span>
            <span className="font-semibold text-foreground">
              {data.duration}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Workspace boundary card ───────────────────────────────────────── */
export function BoundaryCard({label, scope}: {label: string; scope: string}) {
  return (
    <div className={TERMINAL_PANEL}>
      <div
        className={`${TERMINAL_SECTION} flex items-center justify-between px-3 py-2`}
      >
        <p className="text-[9px] font-semibold uppercase tracking-wider text-foreground/45">
          {label}
        </p>
        <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-600/85 dark:text-emerald-400/85">
          <CheckCircle2 className="h-2.5 w-2.5" /> Enforced
        </span>
      </div>
      <p className="px-3 py-2 text-[10px] leading-snug text-foreground/75">
        {scope}
      </p>
    </div>
  );
}

/* ── Full details sidebar ──────────────────────────────────────────── */
export interface DetailsSidebarProps {
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}

export function DetailsSidebar({
  tabs,
  activeTab,
  onTabChange,
  onClose,
  children,
}: DetailsSidebarProps) {
  return (
    <aside className="flex h-full min-h-0 animate-slide-in-right flex-col overflow-hidden bg-background/60 dark:bg-background/40">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-foreground/10 px-3 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTabChange(t)}
              className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${
                activeTab === t
                  ? "bg-foreground/[0.06] text-foreground dark:bg-foreground/[0.08]"
                  : "text-foreground/50 hover:text-foreground/80"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full p-1 text-foreground/45 transition hover:bg-foreground/5 hover:text-foreground/70"
          aria-label="Close details sidebar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 overscroll-contain">
        {children}
      </div>
    </aside>
  );
}

/* ── Changes tab (aggregated file diffs from a run) ────────────────── */
export function ChangesTab({ steps }: { steps: TraceStepData[] }) {
  const changes = collectFileChanges(steps);

  if (changes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No file changes yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {changes.map((change) => (
        <div key={change.id} className="overflow-hidden rounded-lg border border-foreground/10">
          <div className="flex items-center justify-between border-b border-foreground/[0.06] bg-foreground/[0.015] px-3 py-2">
            <span className="text-xs font-semibold text-foreground/90 truncate">
              {change.file}
            </span>
            <span className="shrink-0 flex items-center gap-1.5 font-medium tabular-nums text-[11px]">
              <span className="text-emerald-600 dark:text-emerald-450 font-semibold">+{change.additions}</span>
              <span className="text-red-500 dark:text-red-400 font-semibold">-{change.deletions}</span>
            </span>
          </div>
          <div className="max-h-96 overflow-y-auto p-3 select-text">
            <UnifiedDiffView text={change.body} />
          </div>
        </div>
      ))}
    </div>
  );
}
