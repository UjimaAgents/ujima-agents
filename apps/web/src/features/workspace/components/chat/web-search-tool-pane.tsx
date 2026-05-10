import { ExternalLink } from "lucide-react";
import {
  TERMINAL_OUTPUT_SCROLL_FRAME,
  TERMINAL_PANEL,
  TERMINAL_SECTION,
} from "./terminal-chrome";

export interface WebSearchResultRow {
  title: string;
  url: string;
  snippet: string;
  source: string;
  rank: number;
}

export function WebSearchToolPane({
  className = "",
  query,
  site,
  status,
  source,
  results,
}: {
  className?: string;
  query: string;
  site?: string;
  /** Kept for callers / streaming vs completed logic; not shown in UI. */
  status: "streaming" | "completed";
  source: string;
  results: WebSearchResultRow[];
}) {
  return (
    <div className={`${TERMINAL_PANEL} ${className}`}>
      <div className={`${TERMINAL_SECTION} border-b border-violet-500/[0.06] dark:border-white/[0.06]`}>
        <div className="px-2.5 py-1.5">
          <div className="min-w-0">
            <p className="font-mono text-[10px] leading-snug text-foreground/70">{query}</p>
            {site ? (
              <p className="mt-0.5 truncate font-mono text-[10px] text-foreground/45">
                site:{site}
              </p>
            ) : null}
            <p className="mt-0.5 text-[9px] uppercase tracking-wide text-foreground/40">{source}</p>
            <p className="mt-0.5 text-[9px] uppercase tracking-wide text-foreground/35">
              {status === "streaming" ? "streaming" : "done"}
            </p>
          </div>
        </div>
      </div>

      <div className={`${TERMINAL_OUTPUT_SCROLL_FRAME} px-2.5 py-1.5`}>
        {results.length === 0 ? (
          <div className="text-[11px] text-foreground/45">Searching…</div>
        ) : (
          <ul className="space-y-2">
            {results.map((result) => (
              <li key={`${result.rank}:${result.url}`}>
                <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-1.5 gap-y-0.5">
                  <span className="pt-[1px] font-mono text-[10px] tabular-nums text-foreground/35">
                    {String(result.rank).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-start gap-1 text-[11px] font-medium leading-snug text-foreground hover:underline"
                    >
                      <span className="min-w-0 truncate">{result.title}</span>
                      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-50" aria-hidden />
                    </a>
                    <span className="ml-1 inline text-[9px] text-foreground/40">· {result.source}</span>
                  </div>
                  {result.snippet ? (
                    <p className="col-span-2 pl-[calc(1.75rem+0.375rem)] text-[11px] leading-snug text-foreground/65">
                      {result.snippet}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
