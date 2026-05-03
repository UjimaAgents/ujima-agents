import {AlertCircle} from "lucide-react";

export interface ApprovalCardData {
  id: string;
  runId?: string;
  title: string;
  description: string;
  /** Human-readable shell line + cwd when applicable */
  commandPreview?: string;
  status: "pending" | "approved" | "rejected";
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
  onResolve?: (resolution: "allow_once" | "allow_always" | "reject") => void;
}) {
  const isPending = data.status === "pending";
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-amber-200 bg-white dark:border-amber-500/30 dark:bg-zinc-900">
            <AlertCircle className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <p className="text-xs font-bold text-zinc-900 dark:text-white">
              {data.title}
            </p>
            <p className="text-[10px] text-zinc-500">{data.description}</p>
            {data.commandPreview ? (
              <pre className="mt-1.5 max-h-28 overflow-y-auto rounded-lg border border-amber-200/80 bg-white/80 px-2 py-1.5 text-[10px] font-mono leading-relaxed text-zinc-800 whitespace-pre-wrap dark:border-amber-500/20 dark:bg-zinc-950/80 dark:text-zinc-200">
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
                className="rounded-md bg-white px-3 py-1 text-[10px] font-bold text-zinc-900 shadow-sm border border-zinc-200 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-800 dark:border-zinc-700 dark:text-white"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={resolving}
                onClick={() => onResolve?.("allow_once")}
                className="rounded-md bg-emerald-600 px-3 py-1 text-[10px] font-bold text-white shadow-sm border border-emerald-700 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resolving ? "Resolving..." : "Allow for now"}
              </button>
              <button
                type="button"
                disabled={resolving}
                onClick={() => onResolve?.("allow_always")}
                className="rounded-md bg-violet-600 px-3 py-1 text-[10px] font-bold text-white shadow-sm border border-violet-700 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Always Allow
              </button>
            </>
          ) : (
            <span className="rounded-md bg-white px-3 py-1 text-[10px] font-bold text-zinc-900 shadow-sm border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-white">
              {data.status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
