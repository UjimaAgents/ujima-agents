"use client";

import { useEffect, useState, useMemo, useCallback, memo } from "react";
import { AlertTriangle, Clock, KanbanSquare, PlayCircle } from "lucide-react";
import type {
  Goal,
  GoalTask,
  GoalTaskStatus,
  InteractiveQuestion,
} from "@ujima/shared/browser";
import type { BootstrapResponse } from "@ujima/api-schema";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { GoalTaskBoard } from "./tasks/goal-task-board";

interface ChannelGoalsBoardProps {
  channelId?: string;
  members: BootstrapResponse["members"];
}

interface GoalBoardData {
  goals: Goal[];
  tasks: GoalTask[];
  questions: InteractiveQuestion[];
}

const EMPTY_BOARD: GoalBoardData = { goals: [], tasks: [], questions: [] };

async function fetchGoalBoard(channelId?: string): Promise<GoalBoardData> {
  const res = await fetch(
    channelId
      ? `/api/goals?channelId=${encodeURIComponent(channelId)}`
      : "/api/goals"
  );
  if (res.status === 404) return EMPTY_BOARD;
  if (!res.ok) throw new Error("Failed to fetch goals.");
  const data = (await res.json()) as { goals?: Goal[] };
  const goals = data.goals ?? [];
  if (goals.length === 0) return EMPTY_BOARD;

  const details = await Promise.all(
    goals.map(async (goal) => {
      const detailRes = await fetch(
        `/api/goals/${encodeURIComponent(goal.id)}`
      );
      if (!detailRes.ok) throw new Error("Failed to fetch goal details.");
      return (await detailRes.json()) as {
        goal: Goal;
        tasks?: GoalTask[];
        questions?: InteractiveQuestion[];
      };
    })
  );
  return {
    goals: details.map((detail) => detail.goal),
    tasks: details.flatMap((detail) => detail.tasks ?? []),
    questions: details.flatMap((detail) => detail.questions ?? []),
  };
}

export const ChannelGoalsBoard = memo(function ChannelGoalsBoard({
  channelId,
  members,
}: ChannelGoalsBoardProps) {
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<GoalBoardData>(EMPTY_BOARD);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [hasUserSelected, setHasUserSelected] = useState(false);
  const [handoverModalTask, setHandoverModalTask] = useState<{ task: GoalTask; newStatus: GoalTaskStatus } | null>(null);
  const [handoverText, setHandoverText] = useState("");

  const storageKey = `goalSwitcher:${channelId ?? "__workspace__"}`;
  const { goals, tasks, questions } = board;

  const activeGoalId = useMemo<string | null>(() => {
    if (goals.length === 0) return null;
    const sortedByUpdatedAt = [...goals].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    const newestGoalId = sortedByUpdatedAt[0]?.id ?? null;
    if (hasUserSelected) return selectedGoalId;

    const stored =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(storageKey)
        : null;
    if (stored && goals.some((g) => g.id === stored)) {
      const storedGoal = goals.find((g) => g.id === stored) ?? null;
      if (storedGoal && newestGoalId) {
        const storedUpdatedAt = new Date(storedGoal.updatedAt).getTime();
        const newestUpdatedAt = new Date(sortedByUpdatedAt[0].updatedAt).getTime();
        if (storedUpdatedAt >= newestUpdatedAt) return stored;
      }
    }
    return newestGoalId;
  }, [selectedGoalId, goals, storageKey, hasUserSelected]);

  useEffect(() => {
    if (activeGoalId === null) return;
    try {
      localStorage.setItem(storageKey, activeGoalId);
    } catch {
      /* noop */
    }
  }, [activeGoalId, storageKey]);

  const goalTaskCounts = useMemo(() => {
    const counts: Record<string, { total: number; completed: number }> = {};
    for (const goal of goals) {
      const goalTasks = tasks.filter((t) => t.goalId === goal.id && t.status !== "cancelled");
      counts[goal.id] = {
        total: goalTasks.length,
        completed: goalTasks.filter((t) => t.status === "completed").length,
      };
    }
    return counts;
  }, [goals, tasks]);

  const sortedGoals = useMemo(
    () =>
      [...goals].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [goals]
  );

  const selectedGoal = useMemo(
    () => goals.find((g) => g.id === activeGoalId) ?? null,
    [goals, activeGoalId]
  );

  const refresh = useCallback(async () => {
    try {
      const next = await fetchGoalBoard(channelId);
      setBoard(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred.");
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchGoalBoard(channelId);
        if (cancelled) return;
        setBoard(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "An error occurred.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const runAction = useCallback(
    async (
      key: string,
      fn: () => Promise<Response>,
      fallbackMessage: string
    ) => {
      setActionLoading(key);
      try {
        const res = await fn();
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(body?.message || fallbackMessage);
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : fallbackMessage);
      } finally {
        setActionLoading(null);
      }
    },
    [refresh]
  );

  const handleImplement = useCallback(
    (goal: Goal) =>
      runAction(
        `implement:${goal.id}`,
        () =>
          fetch(`/api/goals/${encodeURIComponent(goal.id)}/implement`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }),
        "Failed to implement plan."
      ),
    [runAction]
  );

  const executeStatusUpdate = useCallback(
    (task: GoalTask, newStatus: GoalTaskStatus, handoverSummary?: string) => {
      return runAction(
        task.id,
        () =>
          fetch(`/api/goal-tasks/${encodeURIComponent(task.id)}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: newStatus,
              ...(handoverSummary ? { handoverSummary } : {}),
            }),
          }),
        "Failed to update status."
      );
    },
    [runAction]
  );

  const handleUpdateStatus = useCallback(
    (task: GoalTask, newStatus: GoalTaskStatus) => {
      const hasDependents = tasks.some(
        (candidate) => candidate.dependsOnTaskId === task.id
      );
      if (newStatus === "completed" && hasDependents) {
        setHandoverModalTask({ task, newStatus });
        setHandoverText("");
        return;
      }
      return executeStatusUpdate(task, newStatus);
    },
    [executeStatusUpdate, tasks]
  );

  const handleAnswerQuestion = useCallback(
    async (questionId: string, option: string) => {
      setActionLoading(questionId);
      setBoard((prev) => ({
        ...prev,
        questions: prev.questions.map((q) =>
          q.id === questionId
            ? { ...q, status: "answered", selectedOption: option }
            : q
        ),
      }));
      try {
        const res = await fetch(
          `/api/questions/${encodeURIComponent(questionId)}/answer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ selectedOption: option }),
          }
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(body?.message || "Failed to submit answer.");
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit answer.");
        await refresh();
      } finally {
        setActionLoading(null);
      }
    },
    [refresh]
  );

  const filteredTasks = useMemo(
    () =>
      (activeGoalId ? tasks.filter((t) => t.goalId === activeGoalId) : tasks).filter(
        (t) => t.status !== "cancelled"
      ),
    [tasks, activeGoalId]
  );

  const pendingQuestions = questions.filter(
    (q) => q.status === "pending" && (!q.goalId || q.goalId === activeGoalId)
  );

  if (loading) {
    return (
      <div className="flex h-full flex-1 min-h-0 w-full flex-col items-center justify-center bg-white px-3 py-8 text-zinc-400 dark:bg-[#09090b]">
        <Clock className="h-8 w-8 animate-spin mb-3 text-violet-500" />
        <p className="text-sm font-medium">Loading goals and tasks...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-1 min-h-0 w-full flex-col items-center justify-center bg-white px-3 py-8 text-center dark:bg-[#09090b]">
        <AlertTriangle className="mb-3 h-7 w-7 text-amber-500" />
        <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Tasks unavailable
        </h3>
        <p className="mb-4 max-w-sm text-xs text-zinc-500 dark:text-zinc-400">{error}</p>
        <button
          onClick={() => void refresh()}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-[#09090b]"
        >
          Retry
        </button>
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <div className="flex h-full flex-1 min-h-0 w-full flex-col items-center justify-center bg-white px-3 py-8 text-center dark:bg-[#09090b]">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <KanbanSquare className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          No goals yet
        </h3>
        <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          Create a goal to start tracking tasks in this channel.
        </p>
      </div>
    );
  }

  const counts = selectedGoal ? goalTaskCounts[selectedGoal.id] : null;

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 w-full bg-white px-3 py-3 pt-24 dark:bg-[#09090b] gap-3">
      {/* Compact Goal Switcher Header for Embedded Tab */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800/60">
        <div className="flex flex-wrap items-center gap-3 min-w-[200px] flex-1">
          <Select
            value={activeGoalId ?? ""}
            onChange={(e) => {
              setHasUserSelected(true);
              setSelectedGoalId(e.target.value || null);
            }}
            placeholder="All Goals"
            className="max-w-[280px] w-full sm:w-auto"
            size="sm"
            options={[
              { value: "", label: "All Goals" },
              ...goals.map((goal) => {
                const c = goalTaskCounts[goal.id];
                const label = c ? `${goal.title} (${c.completed}/${c.total})` : goal.title;
                return { value: goal.id, label };
              }),
            ]}
          />

          {selectedGoal && (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-800/50">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  selectedGoal.status === "running"
                    ? "bg-violet-500 animate-pulse"
                    : selectedGoal.status === "completed"
                      ? "bg-emerald-500"
                      : "bg-zinc-400 dark:bg-zinc-600"
                }`}
              />
              <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                {selectedGoal.status === "planning" ? "Planning" : selectedGoal.status}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {counts ? (
            <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/60 px-2.5 py-1 rounded-full border border-zinc-200/50 dark:border-zinc-800/50">
              {counts.completed} / {counts.total} Tasks Completed
            </span>
          ) : null}

          {selectedGoal && selectedGoal.status === "planning" && (
            <button
              onClick={() => handleImplement(selectedGoal)}
              disabled={actionLoading === `implement:${selectedGoal.id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:opacity-50"
            >
              {actionLoading === `implement:${selectedGoal.id}` ? (
                <Clock className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              Implement
            </button>
          )}
        </div>
      </div>

      <GoalTaskBoard
        tasks={filteredTasks}
        questions={pendingQuestions}
        members={members}
        actionLoading={actionLoading}
        refresh={refresh}
        onUpdateStatus={handleUpdateStatus}
        onAnswerQuestion={handleAnswerQuestion}
      />

      <Modal
        isOpen={Boolean(handoverModalTask)}
        onClose={() => setHandoverModalTask(null)}
        title="Task Handover Summary"
      >
        <div className="space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            This task has dependent tasks waiting on it. Provide a handover summary for dependent steps.
          </p>
          <textarea
            value={handoverText}
            onChange={(e) => setHandoverText(e.target.value)}
            placeholder="Handover summary..."
            rows={3}
            className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setHandoverModalTask(null)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (handoverModalTask) {
                  executeStatusUpdate(handoverModalTask.task, handoverModalTask.newStatus, handoverText);
                  setHandoverModalTask(null);
                }
              }}
              className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
            >
              Complete Task
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
});
