"use client";

import { useState } from "react";
import type { ToolRiskClass } from "@ujima/shared";

const OPTIONS: readonly { value: ToolRiskClass; label: string; tooltip: string }[] = [
  { value: "read", label: "Read", tooltip: "Observes state. No side effects." },
  { value: "write", label: "Write", tooltip: "Recoverable, scoped mutation." },
  {
    value: "destructive",
    label: "Destructive",
    tooltip: "Irreversible, scope-escaping, or arbitrary code execution.",
  },
];

interface Props {
  value: ToolRiskClass;
  disabled?: boolean;
  onChange: (next: ToolRiskClass) => Promise<void> | void;
  source: "manual" | "inferred" | "registry" | "unknown";
}

export function McpRiskControl({ value, disabled, onChange, source }: Props) {
  const [pending, setPending] = useState<ToolRiskClass | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = pending ?? value;

  const handle = async (next: ToolRiskClass) => {
    if (next === active || pending || disabled) return;
    setError(null);
    setPending(next);
    try {
      await onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div
        role="radiogroup"
        aria-label="Risk class"
        className="inline-flex overflow-hidden rounded-md border border-zinc-200 text-[11px] dark:border-zinc-800"
      >
        {OPTIONS.map((opt) => {
          const selected = opt.value === active;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              title={opt.tooltip}
              disabled={disabled || pending !== null}
              onClick={() => void handle(opt.value)}
              className={`px-2 py-1 transition ${
                selected
                  ? source === "manual"
                    ? "bg-violet-600 font-semibold text-white"
                    : "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              } ${pending === opt.value ? "opacity-70" : ""}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <span className="text-[10px] text-rose-600 dark:text-rose-400">{error}</span>
      ) : null}
    </div>
  );
}
