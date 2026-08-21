import { memo, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import { formatTimestamp } from "../lib/format-timestamp";
import { describeActivity } from "../activity-events";

const TICK_MS = 30_000;

function subscribeMinuteTick(onChange: () => void) {
  const id = window.setInterval(onChange, TICK_MS);
  return () => window.clearInterval(id);
}

// Bucketed so the snapshot identity only changes when a re-render is
// actually needed (once per tick), keeping useSyncExternalStore cheap.
function minuteTickSnapshot() {
  return Math.floor(Date.now() / TICK_MS);
}

/** Re-renders the row periodically so relative timestamps never go stale. */
function useMinuteTick() {
  return useSyncExternalStore(subscribeMinuteTick, minuteTickSnapshot, () => 0);
}

export const ActivityRow = memo(function ActivityRow({
  event,
  onOpenTask,
}: {
  event: {
    event_id: string;
    type: string;
    publisher: string;
    timestamp: string;
    task_id?: string;
    payload?: unknown;
  };
  /** Called with event.task_id when the row is clicked, if present. */
  onOpenTask?: (taskId: string) => void;
}) {
  useMinuteTick();
  const display = describeActivity(event);
  const clickable = Boolean(event.task_id && onOpenTask);

  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-zinc-900 dark:text-white">{display.title}</p>
        <p className="text-[10px] text-zinc-500">
          {display.detail}
        </p>
      </div>
      <span className="shrink-0 text-[10px] text-zinc-400">
        {formatTimestamp(event.timestamp)}
      </span>
      {clickable ? (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300 transition-colors group-hover:text-violet-500 dark:text-zinc-600" />
      ) : null}
    </>
  );

  if (!clickable) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-3">{inner}</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenTask?.(event.task_id as string)}
      title="View in Tasks"
      className="group flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left text-xs transition-colors hover:border-violet-300 hover:bg-violet-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/5"
    >
      {inner}
    </button>
  );
});
