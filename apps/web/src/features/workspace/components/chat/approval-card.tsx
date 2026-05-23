import { memo } from "react";
import { ShieldAlert } from "lucide-react";
import { MarkdownInline } from "../markdown";
import { shellInvocationDisplayLine, type ParsedFilesystemScope } from "@ujima/shared/browser";
import { FilesystemToolPane } from "./filesystem-tool-pane";
import { TerminalPane } from "./terminal-pane";
import { ExpandableOutput } from "./expandable-output";

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

/** Indent to align with body text past the shield icon (w-8 + gap-3). */
const BODY_INDENT = "pl-11";
const ACTION_BUTTON =
  "inline-flex h-8 cursor-pointer items-center justify-center rounded-xl border px-3.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60";
const ACTION_BUTTON_PRIMARY =
  "border-violet-500/30 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25";
const ACTION_BUTTON_NEUTRAL =
  "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10";
const ACTION_BUTTON_DANGER =
  "border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/15";

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
  const statusTone =
    data.status === "approved"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : data.status === "rejected"
        ? "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  function resolveApproval(resolution: "allow_once" | "allow_always" | "allow_family" | "reject") {
    onResolve?.(resolution);
  }

  return (
    <div
      key={data.id}
      className="animate-approval-in rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-4 shadow-[0_18px_50px_rgba(0,0,0,0.24)] backdrop-blur-md"
    >
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-violet-500/20 bg-violet-500/10 text-violet-200">
          <ShieldAlert className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-5 text-zinc-100">{data.title}</p>
              {data.description ? (
                <MarkdownInline
                  content={data.description}
                  className="mt-0.5 block text-xs leading-5 text-zinc-400"
                />
              ) : null}
            </div>
            {data.reviewers && data.reviewers.length > 0 ? (
              <div className="flex shrink-0 items-center -space-x-1.5 pt-0.5">
                {data.reviewers.map((r, i) => (
                  <div
                    key={i}
                    className={`h-5 w-5 rounded-full ${r.color} border-2 border-zinc-950`}
                  />
                ))}
              </div>
            ) : null}
          </div>
          {data.error ? (
            <p className="mt-1 text-xs font-medium text-red-300">{data.error}</p>
          ) : null}
          {data.shellScope ? (
            <TerminalPane
              className="mt-3"
              cwd={data.shellScope.cwd}
              commandLine={shellInvocationDisplayLine(data.shellScope)}
            />
          ) : data.filesystemScope ? (
            <FilesystemToolPane
              className="mt-3"
              action={data.filesystemScope.action}
              resourcePath={data.filesystemScope.resourcePath}
              body={
                data.filesystemScope.action === "write"
                  ? (data.filesystemScope.patch ?? data.filesystemScope.content)
                  : undefined
              }
            />
          ) : data.commandPreview ? (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/5">
              <ExpandableOutput>
                <pre className="whitespace-pre-wrap break-words px-2 py-1.5 font-mono text-xs leading-relaxed text-zinc-200">
                  {data.commandPreview}
                </pre>
              </ExpandableOutput>
            </div>
          ) : null}
        </div>
      </div>

      {isPending ? (
        <div className={`mt-4 flex flex-wrap gap-2 ${BODY_INDENT}`}>
          <button
            type="button"
            disabled={resolving}
            onClick={() => resolveApproval("reject")}
            className={`${ACTION_BUTTON} ${ACTION_BUTTON_DANGER}`}
          >
            Reject
          </button>
          <button
            type="button"
            disabled={resolving}
            onClick={() => resolveApproval("allow_once")}
            className={`${ACTION_BUTTON} ${ACTION_BUTTON_PRIMARY}`}
          >
            Once
          </button>
          <button
            type="button"
            disabled={resolving}
            onClick={() => resolveApproval("allow_always")}
            className={`${ACTION_BUTTON} ${ACTION_BUTTON_NEUTRAL}`}
          >
            Always
          </button>
          <button
            type="button"
            disabled={resolving}
            onClick={() => resolveApproval("allow_family")}
            className={`${ACTION_BUTTON} ${ACTION_BUTTON_NEUTRAL}`}
          >
            Family
          </button>
        </div>
      ) : (
        <div className={`mt-4 flex justify-end ${BODY_INDENT}`}>
          <span className={`rounded-full border px-3 py-1 text-xs font-medium shadow-sm ${statusTone}`}>
            {statusLabel}
          </span>
        </div>
      )}
    </div>
  );
});
