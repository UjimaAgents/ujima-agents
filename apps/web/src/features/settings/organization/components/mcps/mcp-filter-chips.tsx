"use client";

export type McpToolFilter =
  | "all"
  | "read"
  | "write"
  | "destructive"
  | "needs_review";

interface Props {
  value: McpToolFilter;
  counts: Record<McpToolFilter, number>;
  onChange: (next: McpToolFilter) => void;
}

const ORDER: { key: McpToolFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "read", label: "Read" },
  { key: "write", label: "Write" },
  { key: "destructive", label: "Destructive" },
  { key: "needs_review", label: "Needs review" },
];

export function McpFilterChips({ value, counts, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ORDER.map(({ key, label }) => {
        const active = key === value;
        const count = counts[key] ?? 0;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
              active
                ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
          >
            <span>{label}</span>
            <span className="rounded-full bg-zinc-100 px-1.5 text-[10px] text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
