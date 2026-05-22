"use client";

import { Plus } from "lucide-react";

export function SidebarSectionEmpty({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mx-2 mt-1.5 rounded-lg border border-dashed border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/40">
      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{message}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-violet-600 transition hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
        >
          <Plus className="h-3 w-3" />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
