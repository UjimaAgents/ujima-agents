export function FileListSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50"
        >
          <div className="h-10 w-10 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-36 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-2.5 w-20 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
