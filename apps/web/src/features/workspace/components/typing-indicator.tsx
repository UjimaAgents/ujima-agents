import { memo, useEffect, useMemo, useState } from "react";
import { Avatar } from "./chat/primitives";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 1) return `${totalSeconds}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}hr`;
}

export const TypingIndicator = memo(function TypingIndicator({
  label,
  name,
  colorIndex,
  names,
  activeStep,
  startedAt,
}: {
  label: string;
  name: string;
  colorIndex: number;
  names: string[];
  activeStep?: string;
  startedAt?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const visibleNames = names.slice(0, 3);
  const overflowCount = Math.max(names.length - visibleNames.length, 0);
  const startedAtMs = useMemo(() => {
    if (!startedAt) return undefined;
    const ms = Date.parse(startedAt);
    return Number.isFinite(ms) ? ms : undefined;
  }, [startedAt]);
  const elapsed = startedAtMs === undefined ? undefined : formatElapsed(now - startedAtMs);

  useEffect(() => {
    if (startedAtMs === undefined) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs]);

  return (
    <div className="flex animate-in items-start gap-3 px-3 py-2">
      {names.length > 1 ? (
        <div className="flex items-center -space-x-2">
          {visibleNames.map((visibleName, index) => (
            <Avatar
              key={`${visibleName}:${index}`}
              name={visibleName}
              colorIndex={colorIndex + index}
              size="sm"
            />
          ))}
          {overflowCount > 0 ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white text-[10px] font-bold text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              +{overflowCount}
            </div>
          ) : null}
        </div>
      ) : (
        <Avatar name={name} colorIndex={colorIndex} size="sm" />
      )}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] font-medium text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300">
          <span className="flex items-center gap-1.5">
            {activeStep ? (
              <span className="flex items-center gap-1">
                <span className="font-semibold">
                  {label.replace(/ responding| waiting for approval$/, "")}
                </span>
                <span className="opacity-70">is</span>
                <span className="max-w-[180px] truncate opacity-90 italic">
                  {activeStep.toLowerCase()}...
                </span>
              </span>
            ) : (
              <span>{label}</span>
            )}
            <span className="inline-flex items-center gap-1">
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
            </span>
          </span>
        </div>
        {elapsed ? (
          <div className="px-3 text-[10px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500">
            Working for {elapsed}
          </div>
        ) : null}
      </div>
    </div>
  );
});
