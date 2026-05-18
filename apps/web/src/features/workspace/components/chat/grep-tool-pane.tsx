import {
  TERMINAL_PANEL,
  TERMINAL_SECTION,
} from "./terminal-chrome";
import { ExpandableOutput } from "./expandable-output";

export interface GrepMatchRow {
  path: string;
  lineNumber: number;
  line: string;
}

export function GrepToolPane({
  className = "",
  query,
  path,
  count,
  limit,
  truncated,
  matches,
}: {
  className?: string;
  query: string;
  path: string;
  count: number;
  limit: number;
  truncated?: boolean;
  matches: GrepMatchRow[];
}) {
  return (
    <div className={`${TERMINAL_PANEL} ${className}`}>
      <div className={TERMINAL_SECTION}>
        <div className="px-3 py-2">
          <p className="font-mono text-[10px] leading-snug text-foreground/70">{`grep "${query}"`}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-foreground/45">{path}</p>
          <p className="mt-0.5 text-[9px] uppercase tracking-wide text-foreground/40">
            {count} matches{truncated ? `, limit ${limit}` : ""}
          </p>
        </div>
      </div>

      <ExpandableOutput>
        <div className="px-3 py-2">
          {matches.length === 0 ? (
            <div className="text-[11px] text-foreground/45">No matches.</div>
          ) : (
            <ul className="space-y-1.5">
              {matches.map((match) => (
                <li key={`${match.path}:${match.lineNumber}:${match.line}`}>
                  <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
                    <p className="truncate font-mono text-[10px] text-foreground/55">
                      {match.path}:{match.lineNumber}
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-foreground/75">
                      {match.line}
                    </pre>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ExpandableOutput>
    </div>
  );
}
