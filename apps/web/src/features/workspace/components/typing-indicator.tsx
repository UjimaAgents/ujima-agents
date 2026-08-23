import { memo } from "react";
import { Avatar } from "./chat/primitives";
import { AnimatedCharacters, formatTokens } from "./chat/chat-token-count";

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
  tokenUsage,
  changeSummary,
  onOpenChanges,
}: {
  label: string;
  name: string;
  colorIndex: number;
  names: string[];
  activeStep?: string;
  startedAt?: string;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  changeSummary?: { files: number; additions: number; deletions: number };
  onOpenChanges?: () => void;
}) {
  const visibleNames = names.slice(0, 3);
  const overflowCount = Math.max(names.length - visibleNames.length, 0);
  const hasChanges = !!changeSummary && changeSummary.files > 0;

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
        <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-violet-200/50 bg-violet-50/30 px-3 py-1.5 text-[11px] font-medium text-violet-700 backdrop-blur-sm dark:border-violet-500/20 dark:bg-violet-500/5 dark:text-violet-300">
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
        {tokenUsage || hasChanges ? (
          <div
            className="inline-flex flex-wrap items-center gap-1.5 px-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400"
            aria-live="polite"
          >
            {tokenUsage ? (
              <>
                <span>
                  <span className="opacity-70">in</span>{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">
                    {formatTokens(tokenUsage.inputTokens)}
                  </span>
                </span>
                <span className="opacity-40">·</span>
                <span>
                  <span className="opacity-70">out</span>{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">
                    {formatTokens(tokenUsage.outputTokens)}
                  </span>
                </span>
              </>
            ) : null}
            {hasChanges ? (
              <button
                type="button"
                onClick={onOpenChanges}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                aria-label={`Open changes: ${changeSummary.files} files, ${changeSummary.additions} additions, ${changeSummary.deletions} deletions`}
              >
                <span>{changeSummary.files} {changeSummary.files === 1 ? "file" : "files"}</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  <AnimatedCharacters text={`+${changeSummary.additions}`} />
                </span>
                <span className="text-red-500 dark:text-red-400">
                  <AnimatedCharacters text={`-${changeSummary.deletions}`} />
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});
