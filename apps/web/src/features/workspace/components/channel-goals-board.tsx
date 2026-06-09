"use client";

import {useEffect, useState, useMemo, useCallback, useRef, memo} from "react";
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  GripVertical,
  KanbanSquare,
  MessageSquare,
  PlayCircle,
} from "lucide-react";
import type {
  Goal,
  GoalTask,
  GoalTaskStatus,
  InteractiveQuestion,
} from "@ujima/shared/browser";
import {Avatar} from "./chat/primitives";
import {QuestionCard} from "./chat/question-card";
import type {BootstrapResponse} from "@ujima/api-schema";
import { Select, type SelectOption } from "@/components/ui/select";

interface ChannelGoalsBoardProps {
  channelId?: string;
  members: BootstrapResponse["members"];
}

type ColumnId = "pending" | "blocked" | "in_progress" | "completed";

const COLUMNS: {id: ColumnId; label: string}[] = [
  {id: "pending", label: "To Do"},
  {id: "blocked", label: "Blocked"},
  {id: "in_progress", label: "In Progress"},
  {id: "completed", label: "Done"},
];

const STATUS_TO_COLUMN: Record<GoalTaskStatus, ColumnId> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  blocked: "blocked",
  blocked_by_failure: "blocked",
  failed: "blocked",
  cancelled: "blocked",
};

const COLUMN_TO_STATUS: Record<ColumnId, GoalTaskStatus> = {
  pending: "pending",
  blocked: "blocked",
  in_progress: "in_progress",
  completed: "completed",
};

// Dedup window the backend's GoalSystemService.nudgeAssignee uses
// to suppress repeat nudges. The countdown re-derives time-until-
// next from this constant + lastNudgedAt — keep it in sync if you
// change NUDGE_DEDUP_WINDOW_MS in goal-system.ts.
const NUDGE_DEDUP_WINDOW_MS = 10 * 60 * 1000;

function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function NudgeCountdown({ lastNudgedAtIso }: { lastNudgedAtIso: string }): JSX.Element | null {
  const lastMs = useMemo(() => Date.parse(lastNudgedAtIso), [lastNudgedAtIso]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!Number.isFinite(lastMs)) return null;
  const remaining = lastMs + NUDGE_DEDUP_WINDOW_MS - now;
  if (remaining <= 0) {
    return (
      <div className="flex items-center gap-1 mb-2 px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300 text-[9px] font-semibold w-fit">
        <Clock className="h-3 w-3 shrink-0" />
        <span>Nudging next tick</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 mb-2 px-1.5 py-0.5 rounded bg-zinc-50 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 text-[9px] font-semibold w-fit">
      <Clock className="h-3 w-3 shrink-0" />
      <span>Next nudge in {formatMmSs(remaining)}</span>
    </div>
  );
}

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

interface GoalBoardData {
  goals: Goal[];
  tasks: GoalTask[];
  questions: InteractiveQuestion[];
}

const EMPTY_BOARD: GoalBoardData = {goals: [], tasks: [], questions: []};

async function fetchGoalBoard(channelId?: string): Promise<GoalBoardData> {
  const res = await fetch(
    channelId
      ? `/api/goals?channelId=${encodeURIComponent(channelId)}`
      : "/api/goals"
  );
  if (res.status === 404) return EMPTY_BOARD;
  if (!res.ok) throw new Error("Failed to fetch goals.");
  const data = (await res.json()) as {goals?: Goal[]};
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

interface GoalSwitcherDropdownProps {
  goals: Goal[];
  selectedGoalId: string | null;
  goalTaskCounts: Record<string, {total: number; completed: number}>;
  onSelect: (id: string | null) => void;
  onImplement: (goal: Goal) => void;
  actionLoading: string | null;
}

function GoalSwitcherDropdown({
  goals,
  selectedGoalId,
  goalTaskCounts,
  onSelect,
  onImplement,
  actionLoading,
}: GoalSwitcherDropdownProps) {
  return (
    <div className="flex items-center gap-3">
      <Select
        value={selectedGoalId ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
        placeholder="All Goals"
        className="flex-1"
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

      {selectedGoalId && (() => {
        const goal = goals.find((g) => g.id === selectedGoalId);
        if (!goal || goal.status !== "planning") return null;
        return (
          <button
            onClick={() => onImplement(goal)}
            disabled={actionLoading === `implement:${goal.id}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:opacity-50"
          >
            {actionLoading === `implement:${goal.id}` ? (
              <Clock className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            Implement
          </button>
        );
      })()}
    </div>
  );
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

  const dragTaskId = useRef<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  // State, not ref, so it can be read deterministically inside the
  // activeGoalId useMemo. Refs aren't allowed during render under
  // React 19's strict rules — the ref value could change mid-render
  // and produce different memo results across renders for the same
  // input deps. With state, the only writer is the onSelect handlers
  // below; the dispatch is batched with the setSelectedGoalId call
  // in the same event so this adds zero extra re-renders.
  const [hasUserSelected, setHasUserSelected] = useState(false);

  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  );
  const storageKey = `goalSwitcher:${channelId ?? "__workspace__"}`;

  const {goals, tasks, questions} = board;

  // ---------- goal selection ----------

  // Derived: user's explicit pick (including "All Goals" = null) → localStorage → most-recent goal.
  // Only the dropdown onChange sets selectedGoalId — everything else is derived.
  const activeGoalId = useMemo<string | null>(() => {
    if (goals.length === 0) return null;

    // 1. User's explicit choice — trust it even if null ("All Goals")
    if (hasUserSelected) return selectedGoalId;

    // 2. Stored preference in localStorage
    const stored =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(storageKey)
        : null;
    if (stored && goals.some((g) => g.id === stored)) return stored;

    // 3. Fall back to most recently updated
    return [...goals].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )[0]?.id ?? null;
  }, [selectedGoalId, goals, storageKey, hasUserSelected]);

  // Persist selection to localStorage (allowed: synchronizing external system)
  useEffect(() => {
    if (activeGoalId === null) return;
    try {
      localStorage.setItem(storageKey, activeGoalId);
    } catch {
      /* noop */
    }
  }, [activeGoalId, storageKey]);

  // ---------- derived data ----------

  const goalTaskCounts = useMemo(() => {
    const counts: Record<string, {total: number; completed: number}> = {};
    for (const goal of goals) {
      const goalTasks = tasks.filter((t) => t.goalId === goal.id);
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
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
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
      setError(errorMessage(err, "An error occurred."));
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
        setError(errorMessage(err, "An error occurred."));
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
        setError(errorMessage(err, fallbackMessage));
      } finally {
        setActionLoading(null);
      }
    },
    [refresh]
  );

  const pendingQuestions = questions.filter(
    (q) =>
      q.status === "pending" &&
      (!q.goalId || q.goalId === activeGoalId)
  );

  const handleImplement = useCallback((goal: Goal) =>
    runAction(
      `implement:${goal.id}`,
      () =>
        fetch(`/api/goals/${encodeURIComponent(goal.id)}/implement`, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
        }),
      "Failed to implement plan."
    ), [runAction]);

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
          fetch(`/api/goal-tasks/${encodeURIComponent(task.id)}/status`, {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
              status: newStatus,
              ...(handoverSummary ? {handoverSummary} : {}),
            }),
          }),
        "Failed to update status."
      );
    },
    [runAction, tasks]
  );

  // -- drag and drop --

  const onDragStart = useCallback((taskId: string) => {
    dragTaskId.current = taskId;
  }, []);

  const onDragEnd = useCallback(() => {
    dragTaskId.current = null;
    setDragOverColumn(null);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, colId: ColumnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(colId);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent, colId: ColumnId) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const {clientX, clientY} = e;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      setDragOverColumn((prev) => (prev === colId ? null : prev));
    }
  }, []);

  const onDrop = useCallback(
    (colId: ColumnId) => {
      const taskId = dragTaskId.current;
      setDragOverColumn(null);
      if (!taskId) return;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const currentCol = STATUS_TO_COLUMN[task.status];
      if (currentCol === colId) return;
      const newStatus = COLUMN_TO_STATUS[colId];
      handleUpdateStatus(task, newStatus);
    },
    [tasks, handleUpdateStatus]
  );

  const handleAnswerQuestion = useCallback(async (questionId: string, option: string) => {
    setActionLoading(questionId);
    setBoard((prev) => ({
      ...prev,
      questions: prev.questions.map((q) =>
        q.id === questionId
          ? {...q, status: "answered", selectedOption: option}
          : q
      ),
    }));
    try {
      const res = await fetch(
        `/api/questions/${encodeURIComponent(questionId)}/answer`,
        {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({selectedOption: option}),
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
      setError(errorMessage(err, "Failed to submit answer."));
      await refresh();
    } finally {
      setActionLoading(null);
    }
  }, [refresh]);

  // Filter tasks by selected goal
  const filteredTasks = useMemo(
    () => (activeGoalId ? tasks.filter((t) => t.goalId === activeGoalId) : tasks),
    [tasks, activeGoalId]
  );

  const columnTasks = useMemo(() => {
    const groups: Record<ColumnId, GoalTask[]> = {
      pending: [],
      blocked: [],
      in_progress: [],
      completed: [],
    };
    for (const task of filteredTasks) {
      groups[STATUS_TO_COLUMN[task.status]].push(task);
    }
    return groups;
  }, [filteredTasks]);

  if (loading) {
    return (
      <div className="flex h-full flex-1 min-h-0 w-full flex-col items-center justify-center bg-white px-3 py-8 text-zinc-400 dark:bg-[#09090b]">
        <Clock className="h-8 w-8 animate-spin mb-3" />
        <p className="text-sm font-medium">Loading goals and board state...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-1 min-h-0 w-full flex-col items-center justify-center bg-white px-3 py-8 text-center dark:bg-[#09090b]">
        <AlertTriangle className="mb-3 h-7 w-7 text-zinc-400" />
        <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Tasks unavailable
        </h3>
        <p className="mb-4 max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          {error}
        </p>
        <button
          onClick={() => void refresh()}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-white dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-[#09090b]"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state: no goals at all
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
          Create a goal to start tracking tasks.
        </p>
      </div>
    );
  }

  // Empty state: selected goal has no tasks
  if (selectedGoal && filteredTasks.length === 0 && pendingQuestions.length === 0) {
    const isPlanning = selectedGoal.status === "planning";
    return (
      <div className="flex flex-col flex-1 h-full min-h-0 min-w-0 bg-white px-3 py-3 dark:bg-[#09090b]">
        <div className="pb-3">
          <GoalSwitcherDropdown
            goals={sortedGoals}
            selectedGoalId={selectedGoalId}
            goalTaskCounts={goalTaskCounts}
            onSelect={(id) => { setHasUserSelected(true); setSelectedGoalId(id); }}
            onImplement={handleImplement}
            actionLoading={actionLoading}
          />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <KanbanSquare className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
            No tasks
          </h3>
          <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            This goal has no tasks yet.
          </p>
          {isPlanning && (
            <button
              onClick={() => handleImplement(selectedGoal)}
              disabled={actionLoading === `implement:${selectedGoal.id}`}
              className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition shadow-sm disabled:opacity-50"
            >
              {actionLoading === `implement:${selectedGoal.id}` ? (
                <Clock className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              Implement plan
            </button>
          )}
        </div>
      </div>
    );
  }

  const selectedCount = activeGoalId ? goalTaskCounts[activeGoalId] : null;

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 min-w-0 space-y-4 overflow-y-auto bg-white px-3 py-3 dark:bg-[#09090b]">
      {/* Goal switcher dropdown */}
      <GoalSwitcherDropdown
        goals={sortedGoals}
        selectedGoalId={selectedGoalId}
        goalTaskCounts={goalTaskCounts}
        onSelect={(id) => { setHasUserSelected(true); setSelectedGoalId(id); }}
        onImplement={handleImplement}
        actionLoading={actionLoading}
      />

      {/* Selected goal status indicator */}
      {selectedGoal && (
        <div className="flex items-center gap-2 -mt-2 pb-1">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              selectedGoal.status === "running"
                ? "bg-violet-500 animate-pulse"
                : selectedGoal.status === "completed"
                  ? "bg-emerald-500"
                  : "bg-zinc-400 dark:bg-zinc-600"
            }`}
          />
          <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            {selectedGoal.status === "planning" ? "Planning" : selectedGoal.status}
          </span>
          {selectedCount && (
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {selectedCount.completed}/{selectedCount.total} tasks
            </span>
          )}
        </div>
      )}

      {pendingQuestions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          resolving={actionLoading === q.id}
          onAnswer={handleAnswerQuestion}
        />
      ))}

      <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3 min-h-0 overflow-y-auto pb-4">
        {COLUMNS.map((col) => {
          const tasksInCol = columnTasks[col.id];
          return (
            <div
              key={col.id}
              onDragOver={(e) => onDragOver(e, col.id)}
              onDragLeave={(e) => onDragLeave(e, col.id)}
              onDrop={() => onDrop(col.id)}
              className={`flex flex-col h-full min-h-[400px] rounded-xl border bg-white p-3 transition-all duration-150 dark:bg-[#09090b] ${dragOverColumn === col.id ? "border-zinc-400 dark:border-zinc-600" : "border-zinc-200/60 dark:border-zinc-800/50"}`}
            >
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-zinc-200/60 dark:border-zinc-800/60">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {col.label}
                  </span>
                </div>
                <span className="inline-flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900 text-[10px] font-bold px-2 py-0.5 text-zinc-500 dark:text-zinc-400 border border-zinc-200/20 dark:border-zinc-800/20">
                  {tasksInCol.length}
                </span>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto min-h-0 max-h-[600px] pr-1">
                {tasksInCol.length === 0 ? (
                  <div
                    className={`flex flex-col items-center justify-center py-10 border border-dashed rounded-xl transition-colors duration-150 ${dragOverColumn === col.id ? "border-zinc-400 dark:border-zinc-600" : "border-zinc-200 dark:border-zinc-800"}`}
                  >
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                      {dragOverColumn === col.id ? "Drop here" : "Empty column"}
                    </p>
                  </div>
                ) : (
                  tasksInCol.map((task) => {
                    const assignee = memberById.get(task.assigneeId);
                    const assigneeName = assignee?.name ?? task.assigneeId;
                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={() => onDragStart(task.id)}
                        onDragEnd={onDragEnd}
                        className={`group relative flex flex-col p-3 rounded-xl border bg-white dark:bg-zinc-900 shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.08)] hover:-translate-y-[1px] transition-all duration-200 cursor-grab active:cursor-grabbing ${actionLoading === task.id ? "opacity-50" : ""} border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700`}
                      >
                        {task.dependsOnTaskId && task.status !== "completed" && (
                          <div
                            className="absolute top-3.5 right-3.5 flex items-center justify-center text-amber-500 dark:text-amber-400 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/15 rounded-md p-1"
                            title="Depends on prior task"
                          >
                            <AlertCircle className="h-3.5 w-3.5" />
                          </div>
                        )}

                        <h4
                          className={`text-xs font-semibold text-zinc-900 dark:text-zinc-100 leading-relaxed line-clamp-2 mb-2.5 ${task.dependsOnTaskId ? "pr-6" : ""}`}
                        >
                          {task.title}
                        </h4>

                        {task.status === 'pending' && task.lastNudgedAt && (
                          <NudgeCountdown lastNudgedAtIso={task.lastNudgedAt} />
                        )}

                        <div className="flex items-center justify-between mt-auto pt-3 border-t border-zinc-100 dark:border-zinc-900/60">
                          <div className="flex items-center gap-2">
                            <Avatar name={assigneeName} size="xs" />
                            {task.handoverSummary && (
                              <div
                                className="text-zinc-400 dark:text-zinc-500 cursor-help"
                                title={task.handoverSummary}
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                              </div>
                            )}
                          </div>

                          <GripVertical className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-400 dark:group-hover:text-zinc-500 transition-colors" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
