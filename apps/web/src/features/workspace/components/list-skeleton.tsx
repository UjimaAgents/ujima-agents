"use client";

import { Skeleton } from "@/components/ui/skeleton";

type ListSkeletonVariant = "member" | "activity" | "file" | "conversation" | "card";

const DEFAULT_ROWS: Record<Exclude<ListSkeletonVariant, "conversation">, number> = {
  member: 5,
  activity: 6,
  file: 4,
  card: 3,
};

/**
 * Parametric loading placeholder for list-shaped surfaces.
 * Replaces member/activity/file/conversation/approval skeleton copies.
 */
export function ListSkeleton({
  variant = "member",
  rows,
}: {
  variant?: ListSkeletonVariant;
  rows?: number;
}) {
  if (variant === "conversation") {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className={`flex gap-3 rounded-xl border border-zinc-200 px-3 py-3 dark:border-zinc-800 ${
              index === 0 ? "bg-zinc-50 dark:bg-zinc-900/50" : "bg-white dark:bg-zinc-950"
            }`}
          >
            <Skeleton className="h-7 w-7 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-2.5 w-24 rounded-full" />
              <Skeleton className="h-2.5 w-full max-w-[28rem] rounded-full" />
              <Skeleton className="h-2.5 w-2/3 rounded-full" />
            </div>
          </div>
        ))}
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-2 text-center text-[11px] text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500">
          …
        </div>
      </div>
    );
  }

  if (variant === "file") {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: rows ?? DEFAULT_ROWS.file }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50"
          >
            <Skeleton className="h-10 w-10 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-36 rounded-full" />
              <Skeleton className="h-2.5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === "activity") {
    return (
      <div className="space-y-1.5 p-3">
        {Array.from({ length: rows ?? DEFAULT_ROWS.activity }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg px-2 py-2">
            <Skeleton className="h-6 w-6 rounded-full" />
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-20 rounded-full" />
                <Skeleton className="h-2 w-12 rounded-full" />
              </div>
              <Skeleton className="h-2.5 w-3/4 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div className="space-y-2">
        {Array.from({ length: rows ?? DEFAULT_ROWS.card }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl border border-zinc-200 bg-white/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/60"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-36 rounded-full" />
                <Skeleton className="h-3 w-full rounded-full" />
                <Skeleton className="h-3 w-2/3 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 p-3">
      {Array.from({ length: rows ?? DEFAULT_ROWS.member }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-2.5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-2 w-2 rounded-full" />
        </div>
      ))}
    </div>
  );
}
