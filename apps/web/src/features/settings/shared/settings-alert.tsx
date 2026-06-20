"use client";

import { AlertCircle } from "lucide-react";

export function SettingsErrorAlert({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
      <p className="flex-1 text-xs text-zinc-600 dark:text-zinc-400">{message}</p>
      {onDismiss ? (
        <button onClick={onDismiss} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export function SettingsLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
      <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-400" />
      {label}
    </div>
  );
}
