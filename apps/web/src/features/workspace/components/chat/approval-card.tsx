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
              const option = APPROVAL_OPTIONS[resolution];
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
