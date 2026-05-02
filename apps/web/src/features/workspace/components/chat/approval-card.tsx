import { AlertCircle } from "lucide-react";

export interface ApprovalCardData {
  title: string;
  description: string;
  requestedBy: string;
  approvalsNeeded: number;
  reviewers?: { color: string }[];
}

export function ApprovalCard({ data }: { data: ApprovalCardData }) {
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
            <p className="text-[10px] text-zinc-400">
              Requested by {data.requestedBy} · {data.approvalsNeeded} approvals
              needed
            </p>
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
          <button className="rounded-md bg-white px-3 py-1 text-[10px] font-bold text-zinc-900 shadow-sm border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 dark:text-white">
            Review
          </button>
        </div>
      </div>
    </div>
  );
}
