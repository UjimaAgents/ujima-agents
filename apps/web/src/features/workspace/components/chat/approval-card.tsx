import { memo } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import { MarkdownInline } from "../markdown";
import { shellInvocationDisplayLine, type ParsedFilesystemScope } from "@ujima/shared/browser";
import { FilesystemToolPane } from "./filesystem-tool-pane";
import { TerminalPane } from "./terminal-pane";
import { ExpandableOutput } from "./expandable-output";
import { TERMINAL_PANEL } from "./terminal-chrome";

export interface ApprovalCardData {
  id: string;
  runId?: string;
  /** Conversation thread that produced this approval (when known). */
  threadId?: string;
  /** Member id of the agent that requested approval (stable id for filtering). */
  requestedByMemberId?: string;
  title: string;
  description: string;
  /** Human-readable shell line + cwd when applicable */
  commandPreview?: string;
  shellScope?: {
    cwd: string;
    command: string;
    args?: string[];
  };
  filesystemScope?: ParsedFilesystemScope;
  /**
   * Connector action request (mcp_connector_dispatch_plan.md §5.2). When
   * set, the card renders the §5.2 box (server + tool + args inline)
   * and relabels the `allow_family` button to "Allow for this run" so
   * the connector-tier semantics — task-session-wide grant for the same
   * (agent, server, tool) — read naturally.
   *
   * Mutually exclusive with shellScope / filesystemScope (a single
   * approval has exactly one display shape).
   */
  connectorScope?: {
    serverId: string;
    serverDisplayName: string;
    toolName: string;
    argsPreview: string;
  };
  /**
   * PR 11 — §17.5.6 attachment_request. When set, the card renders
   * the discovery-escalation variant: server info + agent's reason +
   * target (per-agent | channel). The action grant ("first call") is
   * deferred to the standard §5.2 card on the next invoke — PR 11
   * ships single-grant approve/reject only. The two-grant card
   * variant (attachment + first action together) lands in a
   * follow-up so PR 11's scope stays inside the ~250-line plan.
   * Mutually exclusive with connectorScope / shellScope /
   * filesystemScope.
   */
  attachmentRequestScope?: {
    serverId: string;
    /** Vendor display name (registry match) or opaque "Custom MCP (id)" label. */
    serverDisplayName: string;
    /** 'agent' = attach to the asking agent; 'channel' = attach to a channel. */
    target: "agent" | "channel";
    /** Member id (agent target) or channel id (channel target). */
    targetId: string;
    /** Human-readable label for the target — agent name or channel name. */
    targetDisplayName: string;
    /** The agent's own reasoning text, shown verbatim to the operator. */
    agentReason: string;
  };
  status: "pending" | "approved" | "rejected";
  /** Display name for the requesting agent */
  requestedBy: string;
  createdAt?: string;
  approvalsNeeded: number;
  reviewers?: { color: string }[];
  error?: string;
}

const APPROVAL_OPTIONS: Record<"reject" | "allow_once" | "allow_always" | "allow_family", {
  label: string;
  icon: typeof X;
}> = {
  reject: {
    label: "Reject",
    icon: X,
  },
  allow_once: {
    label: "Allow once",
    icon: Check,
  },
  allow_always: {
    label: "Always allow",
    icon: Check,
  },
  allow_family: {
    label: "Allow family",
    icon: Check,
  },
};

// Connector action_request semantics differ from the default
// shell/filesystem allow_family: "Allow for this run" caches the grant
// in the permission store for the current task session (same
// agent + server + tool, same arg shape), not a command family in the
// shell sense. Relabelled at the call site so the card reads correctly
// to operators who aren't aware of the §17.5 vocabulary.
const APPROVAL_OPTIONS_CONNECTOR: typeof APPROVAL_OPTIONS = {
  ...APPROVAL_OPTIONS,
  allow_family: {
    // "Allow for this run" — relabelled connector_action_request
    // variant of allow_family. The gate caches the grant in the
    // permission store for the current task session, not a shell-
    // sense command family. Renders the same icon as the other
    // approve actions; the difference is only the label so
    // operators not aware of the §17.5 vocabulary read it
    // correctly.
    label: "Allow for this run",
    icon: Check,
  },
};

/**
 * Renders the §5.2 action-request box: server label, tool label, and a
 * monospace args preview. Args are pre-redacted upstream (the un-redacted
 * value lives only in the audit row's `args_json` column, gated by the
 * org's redaction policy) so this component never sees raw secrets even
 * if the policy fails open — it just shows whatever string the caller
 * handed it.
 */
function ConnectorActionPane({
  className,
  scope,
}: {
  className?: string;
  scope: NonNullable<ApprovalCardData["connectorScope"]>;
}) {
  return (
    <div
      className={`rounded-md border border-violet-500/[0.06] bg-white/60 px-3 py-2 dark:border-white/10 dark:bg-white/5 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] leading-relaxed text-foreground/85">
        <span>
          <span className="text-foreground/55">Server:</span>{" "}
          <span className="text-foreground">{scope.serverDisplayName}</span>
        </span>
        <span className="text-foreground/35">·</span>
        <span>
          <span className="text-foreground/55">Tool:</span>{" "}
          <span className="text-foreground">{scope.toolName}</span>
        </span>
      </div>
      {scope.argsPreview.length > 0 ? (
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/80">
          {scope.argsPreview}
        </pre>
      ) : (
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-foreground/55">
          (no arguments)
        </p>
      )}
    </div>
  );
}

/**
 * PR 11 — §17.5.6 attachment_request pane. Shows the operator who's
 * asking, what server, where it'll land (per-agent or channel), and
 * the agent's own reason. Visual cousin of ConnectorActionPane but
 * without the args preview — attachment doesn't carry call arguments,
 * just consent to add the connector to the effective set.
 *
 * The action grant ("Allow first call") is deferred to the standard
 * §5.2 card on the next invoke. PR 11 ships single-grant approve/
 * reject; PR 11.5 will fold the two-grant layout in.
 */
function AttachmentRequestPane({
  className,
  scope,
}: {
  className?: string;
  scope: NonNullable<ApprovalCardData["attachmentRequestScope"]>;
}) {
  return (
    <div
      className={`rounded-md border border-violet-500/[0.06] bg-white/60 px-3 py-2 dark:border-white/10 dark:bg-white/5 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] leading-relaxed text-foreground/85">
        <span>
          <span className="text-foreground/55">Attach:</span>{" "}
          <span className="text-foreground">{scope.serverDisplayName}</span>
        </span>
        <span className="text-foreground/35">·</span>
        <span>
          <span className="text-foreground/55">
            To {scope.target === "channel" ? "channel" : "agent"}:
          </span>{" "}
          <span className="text-foreground">{scope.targetDisplayName}</span>
        </span>
      </div>
      <div className="mt-2 rounded-md bg-white/40 p-2 dark:bg-white/5">
        <p className="text-[10px] uppercase tracking-wide text-foreground/55">
          Reason (from agent)
        </p>
        <p className="mt-1 text-[12px] leading-snug text-foreground/90">
          {scope.agentReason}
        </p>
      </div>
    </div>
  );
}

export const ApprovalCard = memo(function ApprovalCard({
  data,
  resolving,
  onResolve,
}: {
  data: ApprovalCardData;
  resolving?: boolean;
  onResolve?: (approvalId: string, resolution: "allow_once" | "allow_always" | "allow_family" | "reject") => void;
}) {
  const isPending = data.status === "pending";
  const statusLabel =
    data.status === "approved"
      ? "Approved"
      : data.status === "rejected"
        ? "Rejected"
        : "Pending";
  function resolveApproval(resolution: "allow_once" | "allow_always" | "allow_family" | "reject") {
    onResolve?.(data.id, resolution);
  }
  const approvalsText = data.approvalsNeeded === 1 ? "1 approval needed" : `${data.approvalsNeeded} approvals needed`;
  const showDescription = data.description && !data.shellScope && !data.filesystemScope && !data.commandPreview;

  return (
    <div
      key={data.id}
      className={`${TERMINAL_PANEL} animate-in fade-in-50 slide-in-from-bottom-1 duration-150`}
    >
      <div className="space-y-3 px-3 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-violet-500/[0.12] bg-violet-500/[0.08] text-violet-200">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Approval needed
                </p>
                <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-foreground/45">
                  {data.requestedBy} • {approvalsText}
                </p>
              </div>
              {data.reviewers && data.reviewers.length > 0 ? (
                <div className="flex shrink-0 items-center -space-x-1.5 pt-0.5">
                  {data.reviewers.map((r, i) => (
                    <div key={i} className={`h-5 w-5 rounded-full ${r.color} border-2 border-zinc-950`} />
                  ))}
                </div>
              ) : null}
            </div>
            {showDescription ? (
              <MarkdownInline
                content={data.description}
                className="mt-1 block text-sm leading-6 text-foreground/65"
              />
            ) : null}
            {data.error ? (
              <p className="mt-1 text-[11px] font-medium leading-relaxed text-red-700 dark:text-red-300">
                {data.error}
              </p>
            ) : null}
          </div>
        </div>

        {data.shellScope ? (
          <TerminalPane
            className="mt-1"
            cwd={data.shellScope.cwd}
            commandLine={shellInvocationDisplayLine(data.shellScope)}
          />
        ) : data.filesystemScope ? (
          <FilesystemToolPane
            className="mt-1"
            action={data.filesystemScope.action}
            resourcePath={data.filesystemScope.resourcePath}
            body={
              data.filesystemScope.action === "write"
                ? (data.filesystemScope.patch ?? data.filesystemScope.content)
                : undefined
            }
          />
        ) : data.connectorScope ? (
          <ConnectorActionPane className="mt-1" scope={data.connectorScope} />
        ) : data.attachmentRequestScope ? (
          <AttachmentRequestPane
            className="mt-1"
            scope={data.attachmentRequestScope}
          />
        ) : data.commandPreview ? (
          <div className="mt-1">
            <ExpandableOutput>
              <pre className="whitespace-pre-wrap break-words rounded-md border border-violet-500/[0.06] bg-white/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground dark:border-white/10 dark:bg-white/5">
                {data.commandPreview}
              </pre>
            </ExpandableOutput>
          </div>
        ) : null}

        {isPending ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(["reject", "allow_once", "allow_always", "allow_family"] as const).map((resolution) => {
              const option = (data.connectorScope ? APPROVAL_OPTIONS_CONNECTOR : APPROVAL_OPTIONS)[resolution];
              const Icon = option.icon;
              return (
                <button
                  key={resolution}
                  type="button"
                  disabled={resolving}
                  onClick={() => resolveApproval(resolution)}
                  className="group flex w-full cursor-pointer items-center gap-2 rounded-md border border-violet-500/[0.06] px-2.5 py-2 text-left font-mono text-[11px] leading-relaxed text-foreground/80 transition hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                >
                  <span className="shrink-0">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 font-medium">{option.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex justify-end pt-0.5">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-foreground/65">
              {statusLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
