"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  AlertTriangle,
  Clock,
  KanbanSquare,
  LayoutGrid,
  List as ListIcon,
  PlayCircle,
  Plus,
  Search,
  User,
  CheckCircle2,
  SlidersHorizontal,
  FolderKanban,
  Sparkles,
} from "lucide-react";
import type {
  Goal,
  GoalTask,
  GoalTaskStatus,
  InteractiveQuestion,
} from "@ujima/shared/browser";
import type { BootstrapResponse } from "@ujima/api-schema";
import { Select } from "@/components/ui/select";
import { clientFetchJson } from "@/lib/client-api";
import { GoalTaskBoard, type ViewMode } from "./goal-task-board";

interface WorkspaceTasksViewProps {
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
  let data: { goals?: Goal[] };
  try {
    data = await clientFetchJson(
      channelId ? `/api/goals?channelId=${encodeURIComponent(channelId)}` : "/api/goals",
      {},
      "Failed to fetch goals.",
    );
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) return EMPTY_BOARD;
    throw error;
  }
  const goals = data.goals ?? [];
  if (goals.length === 0) return EMPTY_BOARD;

  const details = await Promise.all(
    goals.map(async (goal) => {
      return clientFetchJson<{
        goal: Goal;
        tasks?: GoalTask[];
        questions?: InteractiveQuestion[];
      }>(`/api/goals/${encodeURIComponent(goal.id)}`, {}, "Failed to fetch goal details.");
    })
  );
  return {
    goals: details.map((detail) => detail.goal),
    tasks: details.flatMap((detail) => detail.tasks ?? []),
    questions: details.flatMap((detail) => detail.questions ?? []),
  };
}

export function WorkspaceTasksView({ channelId, members }: WorkspaceTasksViewProps) {
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<GoalBoardData>(EMPTY_BOARD);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [hasUserSelected, setHasUserSelected] = useState(false);
  const [subView, setSubView] = useState<"board" | "list" | "my_tasks">("board");
  const [searchQuery, setSearchQuery] = useState("");

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
      fn: () => Promise<unknown>,
      fallbackMessage: string
    ) => {
      setActionLoading(key);
      try {
        await fn();
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
          clientFetchJson(`/api/goals/${encodeURIComponent(goal.id)}/implement`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }, "Failed to implement plan."),
        "Failed to implement plan."
      ),
    [runAction]
  );

  const handleUpdateStatus = useCallback(
    (task: GoalTask, newStatus: GoalTaskStatus) => {
      const hasDependents = tasks.some(
        (candidate) => candidate.dependsOnTaskId === task.id
      );
      const handoverSummary =
        newStatus === "completed" && hasDependents
          ? window.prompt("Handover summary for dependent tasks")
          : undefined;
      if (handoverSummary === null) return;
      return runAction(
        task.id,
        () =>
          clientFetchJson(`/api/goal-tasks/${encodeURIComponent(task.id)}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: newStatus,
              ...(handoverSummary ? { handoverSummary } : {}),
            }),
          }, "Failed to update status."),
        "Failed to update status."
      );
    },
    [runAction, tasks]
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
        await clientFetchJson(
          `/api/questions/${encodeURIComponent(questionId)}/answer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ selectedOption: option }),
          },
          "Failed to submit answer.",
        );
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

  const filteredTasks = useMemo(() => {
    let list = activeGoalId ? tasks.filter((t) => t.goalId === activeGoalId) : tasks;
    if (subView === "my_tasks") {
      // Show unassigned or assigned tasks
      list = list.filter((t) => t.assigneeId);
    }
    return list;
  }, [tasks, activeGoalId, subView]);

  const pendingQuestions = questions.filter(
    (q) => q.status === "pending" && (!q.goalId || q.goalId === activeGoalId)
  );

  const activeGoalCounts = selectedGoal ? goalTaskCounts[selectedGoal.id] : null;

  if (loading) {
    return (
      <div className="flex h-full flex-1 min-h-0 w-full flex-col items-center justify-center bg-white px-3 py-8 text-zinc-400 dark:bg-[#09090b]">
        <Clock className="h-8 w-8 animate-spin mb-3 text-violet-500" />
        <p className="text-sm font-medium">Loading workspace tasks...</p>
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
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 w-full bg-white dark:bg-[#09090b]">
      {/* ---------- Compact Workspace Header Bar ---------- */}
      <div className="border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/40 px-4 py-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
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
                  const counts = goalTaskCounts[goal.id];
                  const label = counts
                    ? `${goal.title} (${counts.completed}/${counts.total})`
                    : goal.title;
                  return { value: goal.id, label };
                }),
              ]}
            />

            {/* View switcher tabs */}
            <div className="flex items-center rounded-lg bg-zinc-200/60 dark:bg-zinc-900 p-0.5 border border-zinc-200/50 dark:border-zinc-800/50">
              <button
                onClick={() => setSubView("board")}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition ${
                  subView === "board"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Board
              </button>
              <button
                onClick={() => setSubView("list")}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition ${
                  subView === "list"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                <ListIcon className="h-3.5 w-3.5" />
                List
              </button>
              <button
                onClick={() => setSubView("my_tasks")}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition ${
                  subView === "my_tasks"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                <User className="h-3.5 w-3.5" />
                Assigned
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeGoalCounts && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-3 py-1 rounded-lg shadow-sm">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span>
                  <strong>{activeGoalCounts.completed}</strong> / {activeGoalCounts.total} Tasks Completed
                </span>
              </div>
            )}

            {selectedGoal && selectedGoal.status === "planning" && (
              <button
                onClick={() => handleImplement(selectedGoal)}
                disabled={actionLoading === `implement:${selectedGoal.id}`}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:opacity-50"
              >
                {actionLoading === `implement:${selectedGoal.id}` ? (
                  <Clock className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlayCircle className="h-3.5 w-3.5" />
                )}
                Implement Plan
              </button>
            )}

            {/* Search bar */}
            <div className="relative flex items-center min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
              <input
                type="text"
                placeholder="Filter tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-zinc-200/80 bg-white pl-8 pr-3 py-1 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Main Content Body ---------- */}
      {goals.length === 0 ? (
        <div className="flex h-full flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
            <KanbanSquare className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
            No active goals in workspace
          </h3>
          <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
            Prompt an agent in any channel to plan a goal and tasks will automatically populate here.
          </p>
        </div>
      ) : (
        <GoalTaskBoard
          tasks={filteredTasks}
          questions={pendingQuestions}
          members={members}
          viewMode={subView === "list" ? "list" : "board"}
          searchQuery={searchQuery}
          actionLoading={actionLoading}
          refresh={refresh}
          onUpdateStatus={handleUpdateStatus}
          onAnswerQuestion={handleAnswerQuestion}
        />
      )}
    </div>
  );
}
