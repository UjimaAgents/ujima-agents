import { memo, useState } from "react";
import { CheckCircle2, X, ChevronDown, ChevronRight, Pencil, Search, Terminal, Brain, Target, HelpCircle, BookOpen } from "lucide-react";
import {Markdown} from "../markdown";
import {TERMINAL_PANEL, TERMINAL_SECTION} from "./terminal-chrome";
import {TerminalPane} from "./terminal-pane";
import {BackgroundShellJobPane} from "./background-shell-job-pane";
import {FilesystemToolPane} from "./filesystem-tool-pane";
import {GrepToolPane} from "./grep-tool-pane";
import {WebSearchToolPane} from "./web-search-tool-pane";
import { UnifiedDiffView, looksLikeUnifiedDiff } from "./unified-diff-view";

/* ── Trace step (used in reasoning trace timeline) ─────────────────── */
interface AggregatedOperation {
  id: string;
  type: "edit" | "delete" | "read" | "search" | "shell" | "tool" | "memory" | "goal" | "question" | "procedure";
  file?: string;
  additions: number;
  deletions: number;
  command?: string;
  query?: string;
  body?: string;
  status: "success" | "failed" | "running";
  toolName?: string;
  detail?: string;
  lines?: string;
  terminal?: {
    cwd: string;
    commandLine: string;
    output?: string;
    outputPlaceholder?: string;
    outputTone?: "default" | "error";
  };
}

export interface TraceStepData {
  id: string;
  title: string;
  detail: string;
  reasoning?: string;
  time: string;
  duration: string;
  status: "success" | "running" | "failed";
  subtext?: string;
  /** Stable id of whoever produced this step (agent, or user for user-authored messages). */
  actorId: string;
  /** Display name of the actor, resolved against the workspace member list. */
  actorName: string;
  /** Owning run id when this step was emitted inside an agent run. Absent on user messages and other non-run events. */
  runId?: string;
  aggregatedOperations?: AggregatedOperation[];
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

function getBasename(path?: string): string {
  if (!path) return "file";
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

const Chevron = ({ open }: { open: boolean }) =>
  open ? (
    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
  );

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="shrink-0 flex items-center gap-1.5 font-medium tabular-nums text-[11px]">
      <span className="text-emerald-600 dark:text-emerald-450 font-semibold">+{additions}</span>{" "}
      <span className="text-red-500 dark:text-red-400 font-semibold">-{deletions}</span>
    </span>
  );
}

function DiffBody({ op }: { op: AggregatedOperation }) {
  if (!op.body) return null;
  return (
    <div className={`mt-1.5 overflow-hidden ${TERMINAL_PANEL}`}>
      <div className="flex border-b border-foreground/[0.06] bg-foreground/[0.015] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground/60 justify-between">
        <span>{getBasename(op.file)}</span>
        <DiffStat additions={op.additions} deletions={op.deletions} />
      </div>
      <div className="max-h-60 overflow-y-auto p-2.5 select-text">
        <UnifiedDiffView text={op.body} />
      </div>
    </div>
  );
}

const ROW_BUTTON_CLASS =
  "flex w-full flex-wrap items-center gap-2 text-xs text-foreground/70 hover:text-foreground/90 text-left transition-colors";

function ExpandableRow({
  expanded,
  onToggle,
  header,
  trailing,
  children,
}: {
  expanded: boolean;
  onToggle: (e: React.MouseEvent) => void;
  header: React.ReactNode;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-1 pl-2 animate-in fade-in duration-200">
      <button onClick={onToggle} className={ROW_BUTTON_CLASS}>
        {header}
        {trailing}
        <Chevron open={expanded} />
      </button>
      {expanded ? children : null}
    </div>
  );
}

function AggregatedRunPanel({
  operations,
  autoOpen = false,
}: {
  operations: AggregatedOperation[];
  autoOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState<boolean | undefined>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const panelOpen = isOpen ?? autoOpen;

  const counts = operations.reduce<Record<AggregatedOperation["type"], number>>(
    (acc, op) => ({ ...acc, [op.type]: (acc[op.type] ?? 0) + 1 }),
    { edit: 0, delete: 0, read: 0, search: 0, shell: 0, tool: 0, memory: 0, goal: 0, question: 0, procedure: 0 },
  );
  const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
  const summaryParts = [
    counts.edit && `Edited ${counts.edit} ${plural(counts.edit, "file")}`,
    counts.delete && `deleted ${counts.delete} ${plural(counts.delete, "file")}`,
    counts.read && `explored ${counts.read} ${plural(counts.read, "file")}`,
    counts.search && `${counts.search} ${plural(counts.search, "search", "searches")}`,
    counts.shell && `ran ${counts.shell} ${plural(counts.shell, "command")}`,
    counts.memory && `used memory ${counts.memory} ${plural(counts.memory, "time")}`,
    counts.goal && `updated goals ${counts.goal} ${plural(counts.goal, "time")}`,
    counts.question && `asked ${counts.question} ${plural(counts.question, "question")}`,
    counts.procedure && `updated procedures ${counts.procedure} ${plural(counts.procedure, "time")}`,
    counts.tool && `called ${counts.tool} ${plural(counts.tool, "tool")}`,
  ].filter(Boolean);
  const summaryText = summaryParts.join(", ");

  const toggle = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const Icon =
    counts.edit + counts.delete > 0
      ? Pencil
      : counts.goal > 0
        ? Target
        : counts.question > 0
          ? HelpCircle
          : counts.procedure > 0
            ? BookOpen
            : counts.memory > 0
              ? Brain
              : counts.search > 0 && counts.shell === 0
                ? Search
                : Terminal;

  return (
    <div className="w-full">
      <button
        onClick={() => setIsOpen(!panelOpen)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] px-3 py-2 text-left text-xs font-medium text-foreground/75 shadow-sm transition-all hover:bg-foreground/[0.04] active:bg-foreground/[0.06]"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {Icon !== Terminal ? (
            <Icon className="h-3.5 w-3.5 shrink-0 self-center translate-y-px text-foreground/50" />
          ) : null}
          <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">
            {summaryText || "Executed tool actions"}
          </span>
        </span>
        <Chevron open={panelOpen} />
      </button>

      {panelOpen && operations.length > 0 && (
        <div className="mt-2 pl-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {operations.map((op, index) => {
            const autoExpandOperation = autoOpen && (op.status === "running" || index === operations.length - 1);
            const isExpanded = expanded[op.id] ?? autoExpandOperation;

            if (op.type === "edit" || op.type === "delete") {
              const verb = op.type === "edit" ? "Edited" : "Deleted";
              return (
                <ExpandableRow
                  key={op.id}
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={
                    <span className="break-words">
                      {verb} <span className="font-semibold text-foreground/90">{getBasename(op.file)}</span>
                    </span>
                  }
                  trailing={<DiffStat additions={op.additions} deletions={op.deletions} />}
                >
                  <DiffBody op={op} />
                </ExpandableRow>
              );
            }

            if (op.type === "read") {
              return (
                <div key={op.id} className="py-1 text-xs text-foreground/60 pl-2 truncate">
                  Read <span className="font-semibold text-foreground/75">{getBasename(op.file)}</span>{" "}
                  {op.lines ? <span className="inline-block ml-1 text-foreground/40 font-medium">(lines {op.lines})</span> : null}
                </div>
              );
            }

            if (op.type === "search") {
              return (
                <div key={op.id} className="py-1 text-xs text-foreground/70 pl-2 truncate">
                  Searched for <span className="font-mono text-[11px] text-foreground/80">&ldquo;{op.query}&rdquo;</span>
                  {op.file ? (
                    <> in <span className="font-semibold text-foreground/75">{getBasename(op.file)}</span></>
                  ) : null}
                </div>
              );
            }

            if (op.type === "shell") {
              return (
                <ExpandableRow
                  key={op.id}
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={
                    <span className="break-all whitespace-pre-wrap">
                      Used Terminal
                    </span>
                  }
                >
                  {op.terminal ? (
                    <TerminalPane
                      className="mt-1.5"
                      cwd={op.terminal.cwd}
                      commandLine={op.terminal.commandLine}
                      output={op.terminal.output}
                      outputPlaceholder={op.terminal.outputPlaceholder}
                      outputTone={op.terminal.outputTone}
                    />
                  ) : null}
                </ExpandableRow>
              );
            }

            if (op.type === "memory") {
              const toolName = op.toolName ?? "";
              const verb = toolName.includes("write")
                ? "Saved memory"
                : toolName.includes("forget")
                  ? "Forgot memory"
                  : "Recalled memory";
              return (
                <ExpandableRow
                  key={op.id}
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={
                    <span className="break-words">
                      {verb}
                    </span>
                  }
                >
                  {op.detail ? (
                    <div className={`mt-1.5 p-2.5 select-text font-mono text-[11px] leading-relaxed ${TERMINAL_PANEL}`}>
                      {op.detail}
                    </div>
                  ) : null}
                </ExpandableRow>
              );
            }

            if (op.type === "goal") {
              const toolName = op.toolName ?? "";
              const verb = toolName.includes("start")
                ? "Started goal"
                : "Updated goal task";
              return (
                <ExpandableRow
                  key={op.id}
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={
                    <span className="break-words">
                      {verb}
                    </span>
                  }
                >
                  {op.detail ? (
                    <div className={`mt-1.5 p-2.5 select-text font-mono text-[11px] leading-relaxed ${TERMINAL_PANEL}`}>
                      {op.detail}
                    </div>
                  ) : null}
                </ExpandableRow>
              );
            }

            if (op.type === "question") {
              return (
                <ExpandableRow
                  key={op.id}
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={
                    <span className="break-words">
                      Asked question
                    </span>
                  }
                >
                  {op.detail ? (
                    <div className={`mt-1.5 p-2.5 select-text font-mono text-[11px] leading-relaxed ${TERMINAL_PANEL}`}>
                      {op.detail}
                    </div>
                  ) : null}
                </ExpandableRow>
              );
            }

            if (op.type === "procedure") {
              const toolName = op.toolName ?? "";
              const verb = toolName.includes("add")
                ? "Added procedure"
                : "Removed procedure";
              return (
                <ExpandableRow
                  key={op.id}
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={
                    <span className="break-words">
                      {verb}
                    </span>
                  }
                >
                  {op.detail ? (
                    <div className={`mt-1.5 p-2.5 select-text font-mono text-[11px] leading-relaxed ${TERMINAL_PANEL}`}>
                      {op.detail}
                    </div>
                  ) : null}
                </ExpandableRow>
              );
            }

            if (op.type === "tool") {
              return (
                <ExpandableRow
                  key={op.id}
                  expanded={isExpanded}
                  onToggle={toggle(op.id)}
                  header={
                    <span className="break-words">
                      Called tool{" "}
                      <span className="font-mono text-[11px] text-violet-600 dark:text-violet-400 font-semibold">
                        {op.toolName}
                      </span>
                    </span>
                  }
                >
                  {op.detail ? (
                    <div className={`mt-1.5 p-2.5 select-text font-mono text-[11px] leading-relaxed ${TERMINAL_PANEL}`}>
                      {op.detail}
                    </div>
                  ) : null}
                </ExpandableRow>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}

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
  const rowMargin = step.title.startsWith("Run ·") ? "mt-2" : "";
  const rowPadding = isLast ? "pb-0" : "pb-4";
  const body = step.aggregatedOperations && step.aggregatedOperations.length > 0 ? (
    <AggregatedRunPanel
      operations={step.aggregatedOperations}
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
  ) : step.detail.trim() ? (
    <Markdown content={step.detail} className="!text-[11px] !leading-relaxed !text-foreground/60 mt-0! [&_p]:!my-2.5 [&_ul]:!my-2.5 [&_ol]:!my-2.5 [&_hr]:!my-2.5 [&_table]:!my-2.5 [&_h1]:!text-[11px] [&_h2]:!text-[11px] [&_h3]:!text-[11px] [&_h4]:!text-[11px] [&_h5]:!text-[11px] [&_h6]:!text-[11px]" />
  ) : null;

  return (
    <div
      className={`relative pl-6 ${rowMargin} ${rowPadding}`}
    >
      <div
        className={`absolute left-0 top-1.5 z-[1] h-2 w-2 rounded-full ring-[1.5px] ring-background ${
          step.status === "success"
            ? "bg-emerald-500"
            : step.status === "failed"
              ? "bg-red-500"
              : "bg-violet-500 animate-pulse ring-[3px] ring-violet-500/20"
        }`}
        aria-hidden
      />
      {!isLast ? (
        <div
          className="absolute bottom-0 left-1 top-5 w-px bg-foreground/10"
          aria-hidden
        />
      ) : null}

      <div className="min-w-0">
        <div className="flex min-h-5 items-baseline justify-between gap-3">
          <div className="min-w-0 flex flex-1 flex-wrap items-baseline gap-x-2 gap-y-0">
            <p className="min-w-0 text-xs leading-snug text-foreground trace-step-title">
              <span className="font-semibold">{subject}</span>
              {remainder ? (
                <span className="font-normal">{remainder}</span>
              ) : null}
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
            <Markdown content={step.reasoning} className="!text-[11px] !leading-relaxed !text-foreground/60 mt-1! [&_p]:!my-2.5 [&_ul]:!my-2.5 [&_ol]:!my-2.5 [&_hr]:!my-2.5 [&_table]:!my-2.5 [&_h1]:!text-[11px] [&_h2]:!text-[11px] [&_h3]:!text-[11px] [&_h4]:!text-[11px] [&_h5]:!text-[11px] [&_h6]:!text-[11px]" />
          </details>
        ) : null}
        {body ? <div className="mt-2">{body}</div> : null}
        {step.subtext ? (
          <p className="mt-2 text-[11px] leading-snug text-foreground/45">
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

interface FileChange {
  id: string;
  file: string;
  additions: number;
  deletions: number;
  body: string;
  stepTitle: string;
}

function collectFileChanges(steps: TraceStepData[]): FileChange[] {
  const seen = new Set<string>();
  const changes: FileChange[] = [];
  const fileCounts = new Map<string, number>();

  const pushChange = (change: Omit<FileChange, "id">) => {
    const index = fileCounts.get(change.file) ?? 0;
    fileCounts.set(change.file, index + 1);
    changes.push({ ...change, id: `${change.file}:${change.stepTitle}:${index}` });
  };

  for (const step of steps) {
    // Collect aggregated edit operations
    if (step.aggregatedOperations) {
      for (const op of step.aggregatedOperations) {
        if ((op.type === "edit" || op.type === "delete") && op.body && op.file) {
          const key = `${op.file}:${op.body.slice(0, 80)}`;
          if (!seen.has(key)) {
            seen.add(key);
            pushChange({
              file: op.file,
              additions: op.additions,
              deletions: op.deletions,
              body: op.body,
              stepTitle: step.title,
            });
          }
        }
      }
    }

    // Collect individual filesystem write operations that contain diffs
    if (step.filesystem?.action === "write" && step.filesystem.body && looksLikeUnifiedDiff(step.filesystem.body)) {
      const key = `${step.filesystem.resourcePath}:${step.filesystem.body.slice(0, 80)}`;
      if (!seen.has(key)) {
        seen.add(key);
        pushChange({
          file: step.filesystem.resourcePath,
          additions: 0,
          deletions: 0,
          body: step.filesystem.body,
          stepTitle: step.title,
        });
      }
    }
  }

  // Sort by file path
  changes.sort((a, b) => a.file.localeCompare(b.file));
  return changes;
}

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
