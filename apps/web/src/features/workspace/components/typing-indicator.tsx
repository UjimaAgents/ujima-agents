import { memo } from "react";
import { Avatar } from "./chat/primitives";

function formatTypingSubject(label: string): string {
  return label
    .replace(/\s+(?:is|are)\s+responding$/, '')
    .replace(/\s+(?:is|are)\s+waiting for approval$/, '');
}

export const TypingIndicator = memo(function TypingIndicator({
  label,
  name,
  colorIndex,
  names,
  activeStep,
}: {
  label: string;
  name: string;
  colorIndex: number;
  names: string[];
  activeStep?: string;
  startedAt?: string;
}) {
  const visibleNames = names.slice(0, 3);
  const overflowCount = Math.max(names.length - visibleNames.length, 0);

  return (
    <div className="flex animate-in items-start gap-2 px-3 py-2">
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
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-medium text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300">
          {activeStep ? (
            <span className="min-w-0 truncate">
              <span className="font-semibold">{formatTypingSubject(label)}</span>
              <span className="opacity-70"> is</span>
              <span className="ml-1 max-w-[180px] truncate italic opacity-90">
                {activeStep.toLowerCase()}...
              </span>
            </span>
          ) : (
            <span className="min-w-0 truncate">{label}</span>
          )}
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
          </span>
        </div>
      </div>
    </div>
  );
});
