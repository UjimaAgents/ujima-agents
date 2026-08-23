"use client";

import { useState } from "react";
import { Markdown } from "../markdown";
import { ExpandableRow } from "./primitives";

interface SkillReadPaneProps {
  skillName: string;
  pluginName?: string;
  /** The raw <loaded_skill>...</loaded_skill> block returned by the tool, or a brief error string. */
  output?: string;
  status: "success" | "running" | "failed";
}

function parseLoadedSkillBlock(raw: string): {
  name?: string;
  instructions?: string;
  error?: string;
} {
  if (!raw) return {};

  const cleanText = (value?: string) => {
    const cleaned = value?.replace(/^\s*>\s*$/gm, "").trim();
    return cleaned || undefined;
  };

  // Error case — tool returned { error: "..." }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.error === "string") return { error: cleanText(parsed.error) };
  } catch {
    // not JSON — may be the XML block
  }

  const extract = (tag: string) => {
    const match = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return cleanText(match?.[1]);
  };

  const instructions = extract("instructions");
  return {
    name: extract("name"),
    instructions,
  };
}

export function SkillReadPane({
  skillName,
  pluginName,
  output,
  status,
}: SkillReadPaneProps) {
  const [open, setOpen] = useState(false);
  const parsed = output ? parseLoadedSkillBlock(output) : {};
  const title = parsed.name ?? skillName;
  const instructions = parsed.instructions;
  const isError = status === "failed" || !!parsed.error;
  const rawOutput = output?.replace(/^\s*>\s*$/gm, "").trim();
  const showRawOutput = !!rawOutput && (!instructions || isError);

  const statusLabel = isError ? "Couldn’t read" : status === "running" ? "Reading…" : null;
  const statusBadge = statusLabel ? (
    <span className="text-[10px] text-foreground/45">{statusLabel}</span>
  ) : null;

  return (
    <div>
      <ExpandableRow
        expanded={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        header={
          <div className="flex min-w-0 items-start">
            <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-1.5 leading-tight">
                <span className="trace-step-text shrink-0 text-foreground/45">Read</span>
                <span className="trace-step-text truncate font-semibold text-foreground/85">{title}</span>
              </div>
            </div>
          </div>
        }
        trailing={statusBadge}
      >
        <div className="mt-2 space-y-3 pl-5 select-text">
          {pluginName && (
            <div className="text-[10px] text-foreground/45">
              from <code className="font-mono text-foreground/65">{pluginName}</code>
            </div>
          )}
          {instructions && (
            <div className="border-l border-foreground/10 pl-3 select-text">
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-foreground/40 select-none">
                SKILL.md
              </div>
              <Markdown
                content={instructions}
                className="trace-step-text !leading-relaxed !text-foreground/75 [&_p]:!my-0 [&_code]:!text-[0.875em] whitespace-pre-wrap"
              />
            </div>
          )}
          {parsed.error && (
            <div className="trace-step-text text-foreground/65">
              {parsed.error}
            </div>
          )}
          {showRawOutput && (
            <pre className="trace-step-text-sm max-h-48 overflow-auto whitespace-pre-wrap break-words border-l border-foreground/10 pl-3 font-mono leading-relaxed text-foreground/65">
              {rawOutput}
            </pre>
          )}
        </div>
      </ExpandableRow>
    </div>
  );
}
