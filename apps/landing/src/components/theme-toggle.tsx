"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

function subscribe() {
  return () => undefined;
}

export function ThemeToggle({ compact = false }: { compact?: boolean } = {}) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const isDark = resolvedTheme === "dark";
  const className = compact
    ? "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    : "inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";
  const icon = isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />;

  if (!mounted) {
    return (
      <button type="button" className={className} aria-label="Toggle theme">
        <Moon className="h-4 w-4" />
        {compact ? null : "Theme"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={className}
      aria-label="Toggle theme"
    >
      {icon}
      {compact ? null : isDark ? "Light" : "Dark"}
    </button>
  );
}
