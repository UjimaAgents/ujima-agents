import { memo } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";
import {TERMINAL_PANEL, TERMINAL_SECTION} from "./terminal-chrome";
import {Avatar} from "./primitives";
import {TerminalPane} from "./terminal-pane";
import {BackgroundShellJobPane} from "./background-shell-job-pane";
import {FilesystemToolPane} from "./filesystem-tool-pane";
import {GrepToolPane} from "./grep-tool-pane";
import {WebSearchToolPane} from "./web-search-tool-pane";

/* ── Trace step (used in reasoning trace timeline) ─────────────────── */
export interface TraceStepData {
  id: string;
  title: string;
  detail: string;
  reasoning?: string;
  time: string;
  duration: string;
  status: "success" | "running" | "failed";
  subtext?: string;
  /** Integrated terminal (cwd + command + scrollable output). */
  terminal?: {
    cwd: string;
    commandLine: string;
    output?: string;
    outputPlaceholder?: string;
    outputTone?: "default" | "error";
    /** Live poll + stop for background shell jobs (see BackgroundShellJobPane). */
    streamingJob?: {
      runId: string;
      jobId: string;
      organizationId: string;
    };
  };
  /** Workspace file tool (path + action + optional body). */
  filesystem?: {
    action: "read" | "write";
    resourcePath: string;
    meta?: string;
    body?: string;
    bodyTone?: "default" | "error";
  };
  grep?: {
    query: string;
    path: string;
    count: number;
    limit: number;
    truncated?: boolean;
    matches: {
      path: string;
      lineNumber: number;
      line: string;
    }[];
  };
  webSearch?: {
    query: string;
    site?: string;
    status: "streaming" | "completed";
    source: string;
    results: {
      title: string;
      url: string;
      snippet: string;
      source: string;
      rank: number;
    }[];
  };
}

export const TraceStep = memo(function TraceStep({
  step,
  isLast,
}: {
  step: TraceStepData;
  /** Hide the connector below the dot on the final row. */
  isLast?: boolean;
}) {
  const {subject, remainder} = splitTraceTitle(step.title);
  const showSuccessIcon =
    step.status === "success" && isToolTraceTitle(step.title);
  const isCompactRow =
    step.title.startsWith("Run ·") &&
    !step.detail.trim() &&
    !step.reasoning &&
    !step.subtext &&
    !step.terminal &&
    !step.filesystem &&
    !step.webSearch;
  const body = step.terminal?.streamingJob ? (
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
  ) : step.detail.trim() ? (
    <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/60">
      {step.detail}
    </p>
  ) : null;

  return (
    <div
      className={`flex gap-2.5 ${isLast ? "pb-0" : isCompactRow ? "pb-2" : "pb-5"}`}
    >
      {/* Timeline: dot vertically centered with the title row (h-5 ≈ one text-xs line); spine continues through the step */}
      <div className="relative flex w-3 shrink-0 flex-col items-center self-stretch">
        <div className="flex h-5 shrink-0 items-center justify-center">
          <div
            className={`relative z-[1] h-2 w-2 shrink-0 rounded-full ring-[1.5px] ring-background ${
              step.status === "success"
                ? "bg-emerald-500"
                : step.status === "failed"
                  ? "bg-red-500"
                  : "bg-violet-500"
            }`}
            aria-hidden
          />
        </div>
        {!isLast ? (
          <div
            className="absolute left-1/2 top-5 bottom-[-20px] w-px -translate-x-1/2 bg-foreground/10"
            aria-hidden
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-h-5 items-baseline justify-between gap-3">
          <div className="min-w-0 flex flex-1 flex-wrap items-baseline gap-x-2 gap-y-0">
            <p className="min-w-0 text-xs leading-snug text-foreground">
              <span className="font-semibold">{subject}</span>
              {remainder ? (
                <span className="font-normal">{remainder}</span>
              ) : null}
            </p>
            {showSuccessIcon ? (
              <CheckCircle2
                className="h-3.5 w-3.5 shrink-0 translate-y-[1px] text-emerald-500"
                aria-hidden
              />
            ) : step.status === "failed" ? (
              <XCircle
                className="h-3.5 w-3.5 shrink-0 translate-y-[1px] text-red-500"
                aria-hidden
              />
            ) : null}
          </div>
          <div className="flex shrink-0 items-baseline gap-2.5 whitespace-nowrap text-[11px] tabular-nums leading-snug text-foreground/45">
            <span>{step.time}</span>
            <span className="min-w-[4ch] text-end">{step.duration}</span>
          </div>
        </div>
        {step.reasoning ? (
          <details className="mt-0.5" open={step.status === "running"}>
            <summary className="cursor-pointer list-none text-[11px] leading-snug text-foreground/45">
              Reasoning
            </summary>
            <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/60">
              {step.reasoning}
            </p>
          </details>
        ) : null}
        {body}
        {step.subtext ? (
          <p className="mt-0.5 text-[11px] leading-snug text-foreground/45">
            {step.subtext}
          </p>
        ) : null}
      </div>
    </div>
  );
});

function splitTraceTitle(title: string): {subject: string; remainder: string} {
  const trimmed = title.trim();
  if (!trimmed) return {subject: "", remainder: ""};

  const separators = [
    " sent a message ",
    " responded to ",
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

function isToolTraceTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.includes(" called tool ") ||
    trimmed.includes(" · read ") ||
    trimmed.includes(" · patch ") ||
    trimmed.includes(" · grep ") ||
    trimmed.includes(" · view ") ||
    trimmed.includes(" · write ") ||
    trimmed.includes(" · edit ") ||
    trimmed.includes(" · multiedit ") ||
    trimmed.includes(" · ls ") ||
    trimmed.includes(" · glob ") ||
    trimmed.includes(" · fetch ") ||
    trimmed.includes(" · download ") ||
    trimmed.includes(" · job output ") ||
    trimmed.includes(" · job kill ") ||
    trimmed.includes(" · shell ") ||
    trimmed.includes(" · web search ") ||
    trimmed.includes(" updated ") ||
    trimmed.includes(" used ") ||
    trimmed.includes(" created ") ||
    trimmed.includes(" ran ") ||
    trimmed.includes(" finished ")
  );
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
  agentName: string;
  agentColorIndex?: number;
  statusLabel: string;
  timeLabel: string;
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}

export function DetailsSidebar({
  agentName,
  agentColorIndex = 0,
  statusLabel,
  timeLabel,
  tabs,
  activeTab,
  onTabChange,
  onClose,
  children,
}: DetailsSidebarProps) {
  const isOffline = statusLabel.toLowerCase() === "offline";

  return (
    <aside className="flex h-full animate-slide-in-right flex-col bg-background/60 dark:bg-background/40">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-violet-500/[0.06] bg-violet-500/[0.015] px-4 dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-col">
          <h2 className="text-xs font-semibold text-foreground leading-none">
            Message details
          </h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-1 text-foreground/45 transition hover:bg-foreground/5 hover:text-foreground/70"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
        <div className="flex shrink-0 items-center gap-3">
          <Avatar name={agentName} colorIndex={agentColorIndex} size="lg" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">
                {agentName}
              </p>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                  isOffline
                    ? "bg-foreground/5 text-foreground/55 dark:bg-white/5 dark:text-white/45"
                    : "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400/90"
                }`}
              >
                <div
                  className={`h-1 w-1 rounded-full ${
                    isOffline
                      ? "bg-foreground/30 dark:bg-white/30"
                      : "bg-emerald-600 dark:bg-emerald-400"
                  }`}
                />
                {statusLabel}
              </span>
            </div>
            <p className="text-[10px] text-foreground/50">{timeLabel}</p>
          </div>
        </div>

        <div className="mt-3 flex shrink-0">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              className={`px-2.5 py-1.5 text-[10px] font-semibold transition ${
                activeTab === t
                  ? "border-b-2 border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300"
                  : "text-foreground/50 hover:text-foreground/80"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </aside>
  );
}
