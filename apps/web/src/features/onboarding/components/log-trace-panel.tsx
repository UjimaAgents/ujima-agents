interface LogTraceEntry {
  id: string;
  title: string;
  detail: string;
  level: "info" | "warn" | "error";
}

const LEVEL_CLASS: Record<LogTraceEntry["level"], string> = {
  info: "text-sky-700",
  warn: "text-amber-700",
  error: "text-rose-700",
};

export function LogTracePanel({ entries }: { entries: LogTraceEntry[] }) {
  return (
    <section className="h-full rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Log / Trace</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">ai-elements/call-stack</span>
      </div>
      <div className="space-y-2 rounded-lg border border-zinc-100 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950">
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-md bg-white p-2 dark:bg-zinc-900">
            <p className={`text-xs font-semibold uppercase ${LEVEL_CLASS[entry.level]}`}>{entry.level}</p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{entry.title}</p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{entry.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
