import { ShieldAlert } from "lucide-react";
import { MarkdownInline } from "../markdown";

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
  status: "pending" | "approved" | "rejected";
  /** Display name for the requesting agent */
  requestedBy: string;
  approvalsNeeded: number;
  reviewers?: {color: string}[];
}

export function ApprovalCard({
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
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/90 px-4 py-3 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-violet-50 dark:border-violet-500/20 dark:bg-violet-500/10">
            <ShieldAlert className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {data.title}
            </p>
            <MarkdownInline
              content={data.description}
              className="mt-0.5 block text-[10px] text-zinc-500 dark:text-zinc-400"
            />
            {data.commandPreview ? (
              <pre className="mt-1.5 max-h-28 overflow-y-auto rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[10px] font-mono leading-relaxed whitespace-pre-wrap text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                {data.commandPreview}
              </pre>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.reviewers && (
            <div className="flex items-center -space-x-1 mr-1">
              {data.reviewers.map((r, i) => (
                <div
                  key={i}
                  className={`h-5 w-5 rounded-full ${r.color} border-2 border-white dark:border-zinc-900`}
                />
              ))}
            </div>
          )}
          {isPending ? (
            <>
              <button
                type="button"
                disabled={resolving}
                onClick={() => onResolve?.("reject")}
                className="rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={resolving}
                onClick={() => onResolve?.("allow_once")}
                className="rounded-md border border-violet-700 bg-violet-600 px-3 py-1 text-[10px] font-semibold text-white shadow-sm hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resolving ? "Resolving..." : "Allow for now"}
              </button>
              <button
                type="button"
                disabled={resolving}
                onClick={() => onResolve?.("allow_always")}
                className="rounded-md border border-violet-200 bg-violet-50 px-3 py-1 text-[10px] font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/15"
              >
                Always Allow
              </button>
              {data.shellScope ? (
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => onResolve?.("allow_family")}
                  className="rounded-md border border-violet-200 bg-violet-50 px-3 py-1 text-[10px] font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/15"
                >
                  Always Allow {data.shellScope.command} Family
                </button>
              ) : null}
            </>
          ) : (
            <span className={`rounded-md px-3 py-1 text-[10px] font-semibold shadow-sm border ${statusTone}`}>
              {statusLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
