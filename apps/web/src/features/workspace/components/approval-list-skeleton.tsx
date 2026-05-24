"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function ApprovalListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-xl border border-zinc-200 bg-white/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full bg-zinc-200/80 dark:bg-zinc-800/80" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-36 rounded-full bg-zinc-200/80 dark:bg-zinc-800/80" />
              <Skeleton className="h-3 w-full rounded-full bg-zinc-200/70 dark:bg-zinc-800/70" />
              <Skeleton className="h-3 w-2/3 rounded-full bg-zinc-200/60 dark:bg-zinc-800/60" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
