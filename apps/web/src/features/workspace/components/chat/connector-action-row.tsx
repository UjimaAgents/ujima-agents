import { TERMINAL_PANEL, TERMINAL_SECTION } from "./terminal-chrome";

export type ConnectorActionStatus =
  | { kind: "awaiting_approval" }
  | { kind: "approved"; resolverDisplayName: string; scope: "once" | "this_run" | "always" }
  | { kind: "rejected"; resolverDisplayName: string }
  | { kind: "completed"; auditEventId: string }
  | { kind: "failed"; auditEventId?: string; error: string };

/**
 * Single connector-tool invocation row from §5.3.
 *
 * Reads from the unwrapped audit-event shape: `server.tool` displays
 * directly (not `invoke_connector_tool` with an opaque blob) because
 * `(server_id, tool_name, args_json)` are first-class columns on
 * audit_events after migration 049 + the saveAuditEvent wiring in
 * this PR. The renderer never needs to peek inside `args_json` to
 * reconstruct the tuple.
 *
 * Status transitions read top-down so the timeline preserves the
 * arrow-style trace from the plan mockup. Each step is its own line
 * so an operator can grep the timeline for a single resolution.
 */
export interface ConnectorActionRowData {
  /** Audit row id — used for jump-to-audit and as React key. */
  id: string;
  serverDisplayName: string;
  toolName: string;
  /** Pre-redacted by org policy. Lines are rendered verbatim, monospace. */
  argsPreview: string;
  status: ConnectorActionStatus;
}

function scopeLabel(scope: "once" | "this_run" | "always"): string {
  switch (scope) {
    case "once":
      return "once";
    case "this_run":
      return "this_run";
    case "always":
      return "always";
  }
}

export function ConnectorActionRow({
  data,
  className,
}: {
  data: ConnectorActionRowData;
  className?: string;
}) {
  const statusLines = renderStatusLines(data.status);
  return (
    <div className={`${TERMINAL_PANEL} ${className ?? ""}`}>
      <div className={`${TERMINAL_SECTION} px-3 py-2`}>
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="font-mono text-[10px] uppercase tracking-wide text-foreground/55">
            tool
          </span>
          <span className="font-mono text-foreground">
            {data.serverDisplayName}.{data.toolName}
          </span>
        </div>
        {data.argsPreview.length > 0 ? (
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/80">
            {data.argsPreview}
          </pre>
        ) : null}
        {statusLines.length > 0 ? (
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-foreground/75">
            {statusLines.map((line, index) => (
              <li key={index}>
                <span className="text-foreground/45">{"-> "}</span>
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function renderStatusLines(status: ConnectorActionStatus): string[] {
  switch (status.kind) {
    case "awaiting_approval":
      return ["awaiting approval"];
    case "approved":
      return [
        `approved by @${status.resolverDisplayName} (scope: ${scopeLabel(status.scope)})`,
      ];
    case "rejected":
      return [`rejected by @${status.resolverDisplayName}`];
    case "completed":
      return [`ok (event_id: ${status.auditEventId})`];
    case "failed":
      return [
        status.auditEventId
          ? `failed (event_id: ${status.auditEventId}): ${status.error}`
          : `failed: ${status.error}`,
      ];
  }
}
