"use client";

import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Markdown } from "../markdown";
import { TERMINAL_PANEL, TERMINAL_SECTION } from "./terminal-chrome";

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
    const match = raw.match(new RegExp(`<${tag}>([\s\S]*?)<\/${tag}>`));
    return match?.[1]?.trim() ?? undefined;
  };

  const instructions = extract("instructions");
  return {
    name: extract("name"),
    description: extract("description"),
    instructions,
  };
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
  const hasInstructions = !!parsed.instructions;
  const isError = status === "failed" || !!parsed.error;

  const accentClass = isError
    ? "bg-red-500/[0.08] text-red-700 dark:text-red-300"
    : "bg-violet-500/[0.07] text-violet-700 dark:text-violet-300";

  const badgeClass = isError
    ? "bg-red-500/[0.1] text-red-700 dark:text-red-300"
    : "bg-violet-500/[0.1] text-violet-800 dark:text-violet-200";

  return (
    <div className={TERMINAL_PANEL}>
      {/* Header row */}
      <div
        className={`${TERMINAL_SECTION} flex items-center gap-2.5 px-3 py-2.5`}
      >
        <BookOpen
          className={`h-3.5 w-3.5 shrink-0 ${isError ? "text-red-400" : "text-violet-500"}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${badgeClass}`}
            >
              skill.read
            </span>
            <span className="truncate font-mono text-[11px] font-semibold text-foreground/85">
              {parsed.name ?? skillName}
            </span>
            {pluginName && (
              <span className="text-[10px] text-foreground/45 shrink-0">
                from {pluginName}
              </span>
            )}
          </div>
          {(parsed.description ?? description) && (
            <p className="mt-0.5 text-[10px] leading-snug text-foreground/50 line-clamp-2">
              {parsed.description ?? description}
            </p>
          )}
        </div>
      </div>

      {/* Error state */}
      {parsed.error && (
        <div className="px-3 pb-2.5 pt-0">
          <p className="text-[10px] leading-snug text-red-600 dark:text-red-400">
            {parsed.error}
          </p>
        </div>
      )}

      {/* Instructions expandable */}
      {hasInstructions && (
        <div className="border-t border-foreground/[0.06]">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-foreground/[0.02] transition-colors"
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-foreground/45" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-foreground/45" />
            )}
            <span className="text-[10px] font-semibold text-foreground/55 uppercase tracking-wide">
              Instructions
            </span>
            <span className={`ml-auto inline-block rounded px-1.5 py-0.5 text-[9px] font-medium ${accentClass}`}>
              loaded
            </span>
          </button>

          {open && parsed.instructions && (
            <div className="border-t border-foreground/[0.06] px-3 py-3">
              <Markdown
                content={parsed.instructions}
                className="!text-[11px] !leading-relaxed !text-foreground/70 [&_p]:!my-2 [&_ul]:!my-2 [&_ol]:!my-2 [&_h1]:!text-[11px] [&_h2]:!text-[11px] [&_h3]:!text-[11px] [&_code]:text-[10px]"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
