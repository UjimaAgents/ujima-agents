export function MemberListSkeleton() {
  return (
    <div className="space-y-1.5 p-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="h-7 w-7 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-24 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-2.5 w-16 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800/60" />
          </div>
          <div className="h-2 w-2 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}
