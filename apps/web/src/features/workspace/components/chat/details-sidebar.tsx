import {CheckCircle2, X, XCircle} from "lucide-react";
import {TERMINAL_PANEL, TERMINAL_SECTION} from "./terminal-chrome";
import {Avatar} from "./primitives";
import {TerminalPane} from "./terminal-pane";
import {BackgroundShellJobPane} from "./background-shell-job-pane";
import {FilesystemToolPane} from "./filesystem-tool-pane";

/* ── Trace step (used in reasoning trace timeline) ─────────────────── */
export interface TraceStepData {
  id: string;
  title: string;
  detail: string;
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
  /** Filesystem read/write tool (path + action + optional body). */
  filesystem?: {
    action: "read" | "write";
    resourcePath: string;
    body?: string;
    bodyTone?: "default" | "error";
  };
}

export function TraceStep({
  step,
  isLast,
}: {
  step: TraceStepData;
  /** Hide the connector below the dot on the final row. */
  isLast?: boolean;
}) {
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
        body={step.filesystem.body}
        bodyTone={step.filesystem.bodyTone}
      />
    ) : step.detail.trim() ? (
      <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/60">
        {step.detail}
      </p>
    ) : null;

  return (
    <div className={`flex gap-3 ${isLast ? "pb-0" : "pb-7"}`}>
      {/* Timeline gutter: keeps the dot off the text and centers it on the spine */}
      <div className="relative flex w-[14px] shrink-0 flex-col items-center pt-1">
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
        {!isLast ? (
          <div
            className="absolute left-1/2 top-[14px] bottom-[-28px] w-px -translate-x-1/2 bg-foreground/10"
            aria-hidden
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="min-w-0 text-xs font-semibold leading-snug text-foreground">
              {step.title}
            </p>
            {step.status === "success" && (
              <CheckCircle2
                className="h-3.5 w-3.5 shrink-0 text-emerald-500"
                aria-hidden
              />
            )}
            {step.status === "failed" && (
              <XCircle
                className="h-3.5 w-3.5 shrink-0 text-red-500"
                aria-hidden
              />
            )}
          </div>
          <div className="flex shrink-0 items-baseline gap-3 whitespace-nowrap text-xs tabular-nums leading-snug text-foreground/45">
            <span>{step.time}</span>
            <span className="min-w-[4.5ch] text-end">{step.duration}</span>
          </div>
        </div>
        {body}
        {step.subtext ? (
          <p className="text-[11px] leading-relaxed text-foreground/45">{step.subtext}</p>
        ) : null}
      </div>
    </div>
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
  return (
    <aside className="flex h-full flex-col bg-background/60 dark:bg-background/40">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-violet-500/[0.06] bg-violet-500/[0.015] px-4 dark:border-white/10 dark:bg-white/5">
        <h2 className="text-xs font-semibold text-foreground">
          Message details
        </h2>
        <button
          onClick={onClose}
          className="text-foreground/45 transition hover:text-foreground/70"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="flex shrink-0 items-center gap-3">
          <Avatar name={agentName} colorIndex={agentColorIndex} size="lg" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">
                {agentName}
              </p>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400/90">
                <div className="h-1 w-1 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                {statusLabel}
              </span>
            </div>
            <p className="text-[10px] text-foreground/50">{timeLabel}</p>
          </div>
        </div>

        <div className="mt-4 flex shrink-0">
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

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </aside>
  );
}
