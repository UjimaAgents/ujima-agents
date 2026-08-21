import type { GoalTaskStatus } from "@ujima/shared";

/**
 * Canonical task-status tones. Single source of truth for every surface
 * that renders a task status pill or dot (chat cards, board, list view).
 */
export const TASK_STATUS_PILL_CLASS: Record<GoalTaskStatus, string> = {
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  in_progress: "bg-violet-100/90 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  completed: "bg-emerald-100/90 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  blocked: "bg-amber-100/90 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  blocked_by_failure: "bg-amber-100/90 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  failed: "bg-red-100/90 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  cancelled: "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-400",
};

export const TASK_STATUS_DOT_CLASS: Record<GoalTaskStatus, string> = {
  pending: "bg-zinc-400",
  in_progress: "bg-violet-500",
  completed: "bg-emerald-500",
  blocked: "bg-amber-500",
  blocked_by_failure: "bg-amber-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-400",
};
