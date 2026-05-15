import { Avatar } from "./chat/primitives";

export function TypingIndicator({
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
}) {
  const visibleNames = names.slice(0, 3);
  const overflowCount = Math.max(names.length - visibleNames.length, 0);
  return (
    <div className="flex animate-in items-center gap-3 px-3 py-2">
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
    </div>
  );
}
