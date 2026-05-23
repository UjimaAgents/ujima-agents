export function ActivityListSkeleton() {
  return (
    <div className="space-y-1.5 p-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg px-2 py-2">
          <div className="h-6 w-6 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <div className="h-3 w-20 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-2 w-12 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800/60" />
            </div>
            <div className="h-2.5 w-3/4 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
