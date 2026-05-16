import { formatTimestamp } from "../lib/format-timestamp";
import { describeActivity } from "../activity-events";

export function ActivityRow({
  event,
}: {
  event: {
    event_id: string;
    type: string;
    publisher: string;
    timestamp: string;
    task_id?: string;
    payload?: unknown;
  };
}) {
  const display = describeActivity(event);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-zinc-900 dark:text-white">{display.title}</p>
          <p className="text-[10px] text-zinc-500">
            {display.detail}
          </p>
        </div>
        <span className="text-[10px] text-zinc-400">
          {formatTimestamp(event.timestamp)}
        </span>
      </div>
    </div>
  );
}
