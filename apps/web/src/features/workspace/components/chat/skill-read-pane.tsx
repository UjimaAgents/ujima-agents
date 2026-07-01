"use client";

import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Markdown } from "../markdown";

interface SkillReadPaneProps {
  skillName: string;
  pluginName?: string;
  description?: string;
  /** The raw <loaded_skill>...</loaded_skill> block returned by the tool, or a brief error string. */
  output?: string;
  status: "success" | "running" | "failed";
}

function parseLoadedSkillBlock(raw: string): {
  name?: string;
  description?: string;
  instructions?: string;
  error?: string;
} {
  if (!raw) return {};

  // Error case — tool returned { error: "..." }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.error === "string") return { error: parsed.error };
  } catch {
    // not JSON — may be the XML block
  }

  const extract = (tag: string) => {
    const match = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match?.[1]?.trim() ?? undefined;
  };

  const instructions = extract("instructions");
  return {
    name: extract("name"),
    description: extract("description"),
    instructions,
  };
}

const Chevron = ({ open }: { open: boolean }) =>
  open ? (
    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
  );

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
    <div className="py-1 animate-in fade-in duration-200">
      <button onClick={onToggle} className={ROW_BUTTON_CLASS}>
        <span className="flex-1 min-w-0 truncate text-left">{header}</span>
        {trailing && <span className="shrink-0 ml-auto mr-1.5">{trailing}</span>}
        <Chevron open={expanded} />
      </button>
      {expanded ? children : null}
    </div>
  );
}

export function SkillReadPane({
  skillName,
  pluginName,
  description,
  output,
  status,
}: SkillReadPaneProps) {
  const [open, setOpen] = useState(false);
  const parsed = output ? parseLoadedSkillBlock(output) : {};
  const title = parsed.name ?? skillName;
  const summary = parsed.description ?? description ?? "No description returned.";
  const instructions = parsed.instructions;
  const isError = status === "failed" || !!parsed.error;
  const showRawOutput = !!output?.trim() && (!instructions || isError);

  const statusBadge = isError ? (
    <span className="text-[10px] bg-red-500/10 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded font-mono">Failed</span>
  ) : status === "running" ? (
    <span className="text-[10px] bg-violet-500/10 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded font-mono animate-pulse">Running</span>
  ) : null;

  return (
    <div className="mt-2 pl-2">
      <ExpandableRow
        expanded={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        header={
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-xs text-foreground/85 leading-none">Read skill &ldquo;{title}&rdquo;</div>
            <div className="mt-1 truncate text-[11px] text-foreground/55">{summary}</div>
          </div>
        }
        trailing={statusBadge}
      >
        <div className="mt-3 space-y-3 select-text">
          {pluginName && (
            <div className="flex gap-x-1.5 text-[11px] py-0.5">
              <span className="text-[10px] font-medium text-foreground/45 select-none">Plugin:</span>
              <code className="font-mono text-[10px] text-violet-750 dark:text-violet-300 bg-violet-500/[0.04] dark:bg-white/5 px-1.5 py-0.5 rounded">{pluginName}</code>
            </div>
          )}
          {(parsed.description ?? description) && (
            <div className="flex gap-x-1.5 text-[11px] py-0.5">
              <span className="text-[10px] font-medium text-foreground/45 select-none">Description:</span>
              <span className="text-foreground/75 font-mono">{parsed.description ?? description}</span>
            </div>
          )}
          {instructions && (
            <div className="space-y-1.5 select-text">
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-foreground/40 select-none mb-1">
                <BookOpen className="h-3 w-3 shrink-0 text-violet-500/60 dark:text-violet-400/60" />
                <span>SKILL.md</span>
              </div>
              <div className="pl-2">
                <Markdown
                  content={instructions}
                  className="!text-[11px] !leading-relaxed !text-foreground/75 [&_p]:!my-0 [&_code]:text-[10px] whitespace-pre-wrap font-mono"
                />
              </div>
            </div>
          )}
          {parsed.error && (
            <div className="flex gap-x-1.5 text-[11px] py-0.5">
              <span className="text-[10px] font-medium text-foreground/45 select-none">Error:</span>
              <span className="text-red-600 dark:text-red-400 font-mono">{parsed.error}</span>
            </div>
          )}
          {showRawOutput && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-foreground/[0.03] p-2 font-mono text-[10px] leading-relaxed text-foreground/70">
              {output}
            </pre>
          )}
        </div>
      </ExpandableRow>
    </div>
  );
}
