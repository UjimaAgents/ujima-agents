"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function SettingsEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-8 py-12 dark:border-zinc-700 dark:bg-zinc-900/50">
      <Icon className="mb-3 h-9 w-9 text-zinc-300 dark:text-zinc-600" />
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-center text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
