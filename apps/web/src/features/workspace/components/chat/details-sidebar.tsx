import { CheckCircle2, X, XCircle } from "lucide-react";
import { Avatar } from "./primitives";
import { TerminalPane } from "./terminal-pane";

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
  };
}

export function TraceStep({ step }: { step: TraceStepData }) {
  return (
    <div className="relative pl-5">
      <div className="absolute left-0 top-1 bottom-0 w-px bg-zinc-200 dark:bg-zinc-800" />
      <div
        className={`absolute left-[-3px] top-1 h-1.5 w-1.5 rounded-full ring-4 ring-zinc-50 dark:ring-[#09090b] ${
          step.status === "success"
            ? "bg-emerald-500"
            : step.status === "failed"
              ? "bg-red-500"
              : "bg-violet-500"
        }`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className={`flex items-center gap-1.5 ${step.terminal ? "mb-1" : ""}`}>
            <p className="text-[11px] font-bold text-zinc-900 dark:text-white">
              {step.title}
            </p>
            {step.status === "success" && (
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            )}
            {step.status === "failed" && (
              <XCircle className="h-3 w-3 text-red-500" />
            )}
          </div>
          {step.terminal ? (
            <TerminalPane
              className="mt-0"
              cwd={step.terminal.cwd}
              commandLine={step.terminal.commandLine}
              output={step.terminal.output}
              outputPlaceholder={step.terminal.outputPlaceholder}
              outputTone={step.terminal.outputTone}
            />
          ) : step.detail.trim() ? (
            <p className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
              {step.detail}
            </p>
          ) : null}
          {step.subtext ? (
            <p className="mt-2 text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">{step.subtext}</p>
          ) : null}
          <p
            className={`text-[9px] tabular-nums text-zinc-400 dark:text-zinc-500 ${
              step.terminal ? "mt-2.5" : step.subtext ? "mt-1.5" : step.detail?.trim() ? "mt-1.5" : "mt-0.5"
            }`}
          >
            {step.time}
          </p>
        </div>
        <span className="text-[9px] text-zinc-400 shrink-0">
          {step.duration}
        </span>
      </div>
    </div>
  );
}

/* ── Run summary card ──────────────────────────────────────────────── */
export interface RunSummaryData {
  files: { name: string; additions: number; deletions: number }[];
  tokens: string;
  duration: string;
}

export function RunSummary({ data }: { data: RunSummaryData }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
          Files touched
        </p>
        <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
          Run summary
        </p>
      </div>
      <div className="mt-2 flex gap-3">
        <div className="flex-1 space-y-0.5">
          {data.files.map((f) => (
            <div
              key={f.name}
              className="flex items-center justify-between text-[10px]"
            >
              <span className="text-zinc-600 dark:text-zinc-400">
                {f.name}
              </span>
              <span className="text-emerald-600">
                +{f.additions} -{f.deletions}
              </span>
            </div>
          ))}
        </div>
        <div className="w-px bg-zinc-100 dark:bg-zinc-800" />
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-600 dark:text-zinc-400">Tokens</span>
            <span className="font-bold text-zinc-900 dark:text-white">
              {data.tokens}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-600 dark:text-zinc-400">Duration</span>
            <span className="font-bold text-zinc-900 dark:text-white">
              {data.duration}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Workspace boundary card ───────────────────────────────────────── */
export function BoundaryCard({
  label,
  scope,
}: {
  label: string;
  scope: string;
}) {
  return (
    <div className="rounded-lg bg-emerald-500/10 p-3 border border-emerald-500/20">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          {label}
        </p>
        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-2.5 w-2.5" /> Enforced
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-emerald-800 dark:text-emerald-300">
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
    <aside className="h-full border-l border-zinc-200 bg-zinc-50/50 flex flex-col dark:border-zinc-800 dark:bg-zinc-950/50">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
        <h2 className="text-xs font-bold text-zinc-900 dark:text-white">
          Message details
        </h2>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-600"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          <Avatar name={agentName} colorIndex={agentColorIndex} size="lg" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-zinc-900 dark:text-white">
                {agentName}
              </p>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                <div className="h-1 w-1 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                {statusLabel}
              </span>
            </div>
            <p className="text-[10px] text-zinc-500">{timeLabel}</p>
          </div>
        </div>

        <div className="mt-4 flex border-b border-zinc-200 dark:border-zinc-800">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              className={`px-2.5 py-1.5 text-[10px] font-bold transition ${
                activeTab === t
                  ? "text-violet-600 border-b-2 border-violet-600 dark:text-violet-400 dark:border-violet-400"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </aside>
  );
}
