export function TerminalPane({
  className = "",
  cwd,
  commandLine,
  output,
  outputPlaceholder,
  outputTone = "default",
}: {
  className?: string;
  cwd: string;
  /** Command without leading `$`; the pane renders the prompt. */
  commandLine: string;
  /** Captured stdout/stderr (or error text). */
  output?: string;
  /** Shown when `output` is empty (e.g. pending approval or in-flight tool). */
  outputPlaceholder?: string;
  outputTone?: "default" | "error";
}) {
  const trimmed = output?.trim() ?? "";
  const showBody = trimmed.length > 0;
  const showPlaceholder = !showBody && (outputPlaceholder?.length ?? 0) > 0;
  const showOutputRegion = showBody || showPlaceholder;

  return (
    <div
      className={`overflow-hidden rounded-lg border border-zinc-200/90 bg-zinc-50 text-left shadow-sm dark:border-zinc-800/50 dark:bg-[#121214] dark:shadow-none ${className}`}
    >
      <div className="shrink-0 border-b border-zinc-200/80 dark:border-zinc-800/40">
        <div className="px-3 py-1.5 font-mono text-[10px] leading-snug text-zinc-600 dark:text-zinc-500">
          {cwd}
        </div>
        <div className="px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200">
          <span className="select-none text-zinc-500 dark:text-zinc-500">$ </span>
          <span>{commandLine}</span>
        </div>
      </div>
      {showOutputRegion ? (
        <div
          className={`max-h-[min(36vh,280px)] min-h-[2.5rem] overflow-y-auto overflow-x-auto overscroll-contain border-t border-zinc-200/80 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap [-webkit-overflow-scrolling:touch] dark:border-zinc-800/40 ${
            outputTone === "error"
              ? "text-red-700 dark:text-red-300/90"
              : "text-zinc-700 dark:text-zinc-300/90"
          }`}
        >
          {showBody ? trimmed : null}
          {showPlaceholder ? (
            <span className="text-zinc-500">{outputPlaceholder}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
