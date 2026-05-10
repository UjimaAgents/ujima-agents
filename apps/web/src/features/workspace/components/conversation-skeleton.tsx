import type { SelectedConversation } from "../types";

export function ConversationSkeleton({
  conversation,
}: {
  conversation: SelectedConversation;
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className={`flex gap-3 rounded-xl border border-zinc-200 px-3 py-3 dark:border-zinc-800 ${
            index === 0 ? "bg-zinc-50 dark:bg-zinc-900/50" : "bg-white dark:bg-zinc-950"
          }`}
        >
          <div className="h-7 w-7 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-2.5 w-24 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-2.5 w-full max-w-[28rem] animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
      ))}
      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-2 text-center text-[11px] text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500">
        …
      </div>
    </div>
  );
}
