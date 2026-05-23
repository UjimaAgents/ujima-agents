"use client";

/**
 * Base skeleton primitive — renders an animated pulse placeholder.
 * Use <Skeleton className="h-4 w-24" /> inline, or compose into
 * dedicated skeleton components for repeated patterns.
 */
export function Skeleton({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800 ${className}`}
      {...props}
    />
  );
}
