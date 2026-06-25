"use client";

import { CircleCheck, CircleSlash, Hand } from "lucide-react";
import { useState } from "react";
import type { McpCatalogTool } from "@ujima/api-schema";

type Effective = McpCatalogTool["effective"];
export type ToolRuleState = "allow" | "require_approval" | "deny";

// The three explicit decisions, mirroring the connector permission UI:
// auto-run, prompt for approval, or block. `require_input` collapses to
// the approval icon since both gate on a human.
const OPTIONS: readonly {
  value: ToolRuleState;
  label: string;
  hint: string;
  Icon: typeof CircleCheck;
  activeClass: string;
}[] = [
  {
    value: "allow",
    label: "Allow",
    hint: "Auto-run with no approval prompt",
    Icon: CircleCheck,
    activeClass:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  {
    value: "require_approval",
    label: "Needs approval",
    hint: "Prompt a human before each run",
    Icon: Hand,
    activeClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  },
  {
    value: "deny",
    label: "Deny",
    hint: "Block this tool",
    Icon: CircleSlash,
    activeClass: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  },
];

/** Maps an effective decision to the toggle's visually-active segment. */
function activeFromEffective(effective: Effective): ToolRuleState {
  switch (effective.state) {
    case "allow":
      return "allow";
    case "deny":
      return "deny";
    default:
      // require_approval, require_input, inherit → approval is the
      // safe default the UI highlights.
      return "require_approval";
  }
}

/** True when the active state comes from an explicit per-tool rule (not inherited). */
function isExplicit(effective: Effective): boolean {
  return (
    effective.source === "platform_allow" ||
    effective.source === "platform_deny" ||
    effective.source === "platform_require_approval"
  );
}

export function ToolPolicyToggle({
  effective,
  onChange,
  disabled,
}: {
  effective: Effective;
  onChange: (state: ToolRuleState | "inherit") => Promise<void> | void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<ToolRuleState | null>(null);
  const active = activeFromEffective(effective);
  const explicit = isExplicit(effective);

  const handle = async (next: ToolRuleState) => {
    if (pending || disabled) return;
    // Clicking the active explicit segment clears the rule back to the
    // org default (inherit); otherwise set the chosen state.
    const target = explicit && next === active ? "inherit" : next;
    setPending(next);
    try {
      await onChange(target);
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Tool decision"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-0.5 rounded-full border border-zinc-200 p-0.5 dark:border-zinc-800"
    >
      {OPTIONS.map(({ value, label, hint, Icon, activeClass }) => {
        const selected = value === active;
        const isPending = pending === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={`${label} — ${hint}${selected && explicit ? " (click to reset to default)" : ""}`}
            disabled={disabled || pending !== null}
            onClick={() => void handle(value)}
            className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
              selected
                ? `${activeClass} ${explicit ? "" : "opacity-60 ring-1 ring-inset ring-current"}`
                : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
            } ${isPending ? "animate-pulse" : ""}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
