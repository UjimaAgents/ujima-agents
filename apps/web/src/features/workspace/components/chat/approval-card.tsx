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
  description: string;
  icon: typeof X;
}> = {
  reject: {
    label: "Reject",
    description: "Block this request and keep the workspace unchanged.",
    icon: X,
  },
  allow_once: {
    label: "Allow once",
    description: "Approve this exact action one time only.",
    icon: Check,
  },
  allow_always: {
    label: "Always allow",
    description: "Approve this exact action automatically in the future.",
    icon: Check,
  },
  allow_family: {
    label: "Allow family",
    description: "Approve the same command family and nearby variants.",
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
  onResolve?: (resolution: "allow_once" | "allow_always" | "allow_family" | "reject") => void;
}) {
  const isPending = data.status === "pending";
  const statusLabel =
    data.status === "approved"
      ? "Approved"
      : data.status === "rejected"
        ? "Rejected"
        : "Pending";
  function resolveApproval(resolution: "allow_once" | "allow_always" | "allow_family" | "reject") {
    onResolve?.(resolution);
  }
  const approvalsText = data.approvalsNeeded === 1 ? "1 approval needed" : `${data.approvalsNeeded} approvals needed`;

  return (
    <div
      key={data.id}
      className={`${TERMINAL_PANEL} animate-in fade-in-50 slide-in-from-bottom-1 duration-150`}
    >
      <div className="space-y-3 px-3 py-3">
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-violet-500/[0.12] bg-violet-500/[0.08] text-violet-200">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[11px] leading-relaxed text-foreground/85">
                  Approval needed
                </p>
                <p className="mt-0.5 text-sm font-medium text-foreground">{data.title}</p>
              </div>
              {data.reviewers && data.reviewers.length > 0 ? (
                <div className="flex shrink-0 items-center -space-x-1.5 pt-0.5">
                  {data.reviewers.map((r, i) => (
                    <div key={i} className={`h-5 w-5 rounded-full ${r.color} border-2 border-zinc-950`} />
                  ))}
                </div>
              ) : null}
            </div>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-foreground/55">
              This request is paused until you choose how to handle it.
            </p>
            {data.description ? (
              <MarkdownInline
                content={data.description}
                className="mt-1 block text-sm leading-6 text-foreground/65"
              />
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] leading-relaxed text-foreground/45">
              <span>{data.requestedBy}</span>
              <span>•</span>
              <span>{approvalsText}</span>
            </div>
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

        <div className="pt-0.5">
          <p className="font-mono text-[10px] leading-relaxed text-foreground/45">
            Choose one response. Approval can be one-time or remembered for similar requests.
          </p>
        </div>

        {isPending ? (
          <div className="space-y-1.5">
            {(["reject", "allow_once", "allow_always", "allow_family"] as const).map((resolution) => {
              const option = APPROVAL_OPTIONS[resolution];
              const Icon = option.icon;
              return (
                <button
                  key={resolution}
                  type="button"
                  disabled={resolving}
                  onClick={() => resolveApproval(resolution)}
                  className="group flex w-full items-start gap-2 rounded-md border border-violet-500/[0.06] px-2.5 py-2 text-left font-mono text-[11px] leading-relaxed text-foreground/80 transition hover:border-violet-500/20 hover:bg-foreground/[0.035] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.04]"
                >
                  <span className="mt-0.5 shrink-0">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-foreground/55">
                      {option.description}
                    </span>
                  </span>
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
