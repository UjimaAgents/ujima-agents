"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function SettingsRowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />;
}

export function SettingsListRow({
  leading,
  primary,
  secondary,
  badge,
  actions,
  className = "",
}: {
  leading?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    >
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{primary}</div>
          {badge}
        </div>
        {secondary ? (
          <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{secondary}</div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 pl-1">{actions}</div> : null}
    </div>
  );
}

export function SettingsList({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}
