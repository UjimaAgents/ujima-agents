export function SidebarSkeleton() {
  return (
    <aside className="flex h-full w-full flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#09090b]">
      {/* Header skeleton */}
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-32 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>

      {/* Search skeleton */}
      <div className="px-4 pb-3">
        <div className="h-8 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800/60" />
      </div>

      {/* Channel list skeleton */}
      <div className="flex-1 px-2 space-y-4">
        <div>
          <div className="flex items-center justify-between px-2 py-1.5">
            <div className="h-3 w-16 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-4 w-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-2">
              <div className="h-4 w-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 flex-1 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between px-2 py-1.5">
            <div className="h-3 w-14 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-4 w-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-2">
              <div className="h-5 w-5 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 flex-1 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-2 w-2 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
