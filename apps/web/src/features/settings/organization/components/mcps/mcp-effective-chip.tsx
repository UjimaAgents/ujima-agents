"use client";

import type { McpCatalogTool } from "@ujima/api-schema";

type Effective = McpCatalogTool["effective"];

const LABEL: Record<Effective["state"], string> = {
  allow: "Allow",
  deny: "Denied",
  require_approval: "Approval",
  require_input: "Confirm",
  inherit: "Inherit",
};

const TONE: Record<Effective["state"], string> = {
  allow:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  deny: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  require_approval:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  require_input:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  inherit: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
};

const SOURCE_NOTE: Record<Effective["source"], string> = {
  platform_deny: "platform kill-switch",
  agent_rule: "agent rule",
  platform_allow: "org allowlist",
  platform_require_approval: "platform default",
  risk_default: "org class default",
  default: "no rule",
};

export function McpEffectiveChip({ effective }: { effective: Effective }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[effective.state]}`}
      title={effective.reason ?? `Source: ${SOURCE_NOTE[effective.source]}`}
    >
      {LABEL[effective.state]}
      <span className="text-[10px] opacity-70">· {SOURCE_NOTE[effective.source]}</span>
    </span>
  );
}
