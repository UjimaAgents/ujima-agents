import { ChevronRight, Target } from "lucide-react";

export interface GoalHUDProps {
  goalName: string;
  goalFilePath: string;
  status: string;
  onClick?: () => void;
}

export function GoalHUD({ goalName, goalFilePath, status, onClick }: GoalHUDProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group sticky top-0 z-10 mx-4 mt-2 flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-violet-200/50 bg-white/80 px-4 py-2.5 text-left shadow-sm backdrop-blur transition-all hover:bg-white hover:shadow-md dark:border-violet-500/20 dark:bg-zinc-950/80 dark:hover:bg-zinc-950"
    >
      <div className="flex items-center gap-3 overflow-hidden">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100/50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
          <Target className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-[11px] font-bold text-zinc-900 dark:text-zinc-100">{goalName}</h3>
          <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">{goalFilePath}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="flex flex-col items-end">
          <span className="rounded-full bg-violet-100/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
            {status}
          </span>
        </div>
        <ChevronRight className="h-4 w-4 text-zinc-300 transition-transform group-hover:translate-x-0.5 dark:text-zinc-600" />
      </div>
    </button>
  );
}
