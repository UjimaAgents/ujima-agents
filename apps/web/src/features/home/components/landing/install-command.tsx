"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function InstallCommand({
  command,
  label = "Copy install command",
}: {
  command: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mt-6 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 pr-2 dark:border-zinc-800 dark:bg-zinc-950">
      <code className="flex-1 overflow-x-auto px-4 py-3 font-mono text-sm text-zinc-900 dark:text-zinc-100">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
