import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TERMINAL_PANEL, TERMINAL_SECTION } from "./terminal-chrome";

/**
 * Single dispatch-tier catalog row. Tools is a representative sample
 * (top-N, not exhaustive) so the catalog fits in the system-prompt
 * budget — see the renderer in §7.2 of the dispatch plan for the
 * sanitization + sampling policy.
 */
export interface ConnectorCatalogDispatchEntry {
  serverId: string;
  serverDisplayName: string;
  category?: string;
  toolSample: string[];
  /** Total dispatch tools on this server (may exceed toolSample.length). */
  toolCount: number;
}

export interface ConnectorCatalogRowData {
  nativeServers: { serverId: string; serverDisplayName: string }[];
  dispatchEntries: ConnectorCatalogDispatchEntry[];
}

/**
 * Run-start "Available connectors" row from §5.3 of the dispatch plan.
 *
 * Renders the dispatch-tier catalog so an operator scanning the
 * timeline can see exactly which connectors the agent could reach via
 * `invoke_connector_tool` even when it never actually called any
 * (parity with the system-prompt catalog). Native-tier servers are
 * named but not unrolled — their tools are in the palette so they
 * surface naturally as `[tool] name` rows when used.
 *
 * Defaults to collapsed because the dispatch tier is the long list
 * and most runs only invoke a few entries; expanded view gives the
 * full operator audit.
 */
export function ConnectorCatalogRow({
  data,
  className,
  defaultExpanded = false,
}: {
  data: ConnectorCatalogRowData;
  className?: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const Icon = expanded ? ChevronDown : ChevronRight;
  const totalDispatch = data.dispatchEntries.length;
  const totalNative = data.nativeServers.length;
  return (
    <div className={`${TERMINAL_PANEL} ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`${TERMINAL_SECTION} flex w-full items-center gap-2 border-b border-violet-500/[0.06] px-3 py-2 text-left text-[11px] text-foreground/80 transition hover:bg-foreground/[0.02] dark:border-white/[0.06]`}
        aria-expanded={expanded}
        aria-controls="connector-catalog-body"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-foreground/55" />
        <span className="font-mono text-[10px] uppercase tracking-wide text-foreground/55">
          system
        </span>
        <span className="font-mono">Available connectors (catalog)</span>
        <span className="ml-auto font-mono text-[10px] text-foreground/45">
          {totalNative} native · {totalDispatch} dispatch
        </span>
      </button>

      {expanded ? (
        <div id="connector-catalog-body" className="space-y-3 px-3 py-2 text-[11px]">
          {totalNative > 0 ? (
            <section>
              <p className="font-mono text-[10px] uppercase tracking-wide text-foreground/55">
                Native tier (typed, always available)
              </p>
              <p className="mt-1 font-mono text-foreground/80">
                {data.nativeServers.map((s) => s.serverDisplayName).join(", ")}
              </p>
            </section>
          ) : null}

          {totalDispatch > 0 ? (
            <section>
              <p className="font-mono text-[10px] uppercase tracking-wide text-foreground/55">
                Dispatch tier (call get_connector_tools to see schemas)
              </p>
              <ul className="mt-1 space-y-1">
                {data.dispatchEntries.map((entry) => (
                  <li
                    key={entry.serverId}
                    className="grid grid-cols-[minmax(120px,1fr)_minmax(0,2fr)] gap-x-3 font-mono text-foreground/80"
                  >
                    <span className="truncate">
                      <span className="text-foreground">{entry.serverDisplayName}</span>
                      {entry.category ? (
                        <span className="ml-1 text-foreground/45">[{entry.category}]</span>
                      ) : null}
                    </span>
                    <span className="truncate text-foreground/65">
                      tools: {entry.toolSample.join(", ")}
                      {entry.toolCount > entry.toolSample.length ? (
                        <span className="text-foreground/45">
                          {` +${entry.toolCount - entry.toolSample.length} more`}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {totalNative === 0 && totalDispatch === 0 ? (
            <p className="font-mono text-foreground/55">
              No connectors attached for this run.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
