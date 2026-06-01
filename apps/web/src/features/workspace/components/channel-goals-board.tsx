"use client";

import {useEffect, useState, useMemo, useCallback, useRef} from "react";
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

export function ChannelGoalsBoard({
  channelId,
  members,
}: ChannelGoalsBoardProps) {
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<GoalBoardData>(EMPTY_BOARD);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const dragTaskId = useRef<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);

  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  );
  const scopeLabel = channelId ? "this conversation" : "the workspace";

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

  const {goals, tasks, questions} = board;
  const pendingQuestions = questions.filter((q) => q.status === "pending");

  const handleImplement = (goal: Goal) =>
    runAction(
      `implement:${goal.id}`,
      () =>
        fetch(`/api/goals/${encodeURIComponent(goal.id)}/implement`, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
        }),
      "Failed to implement plan."
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

  const handleAnswerQuestion = async (questionId: string, option: string) => {
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
  };

  const columnTasks = useMemo(() => {
    const groups: Record<ColumnId, GoalTask[]> = {
      pending: [],
      blocked: [],
      in_progress: [],
      completed: [],
    };
    for (const task of tasks) {
      groups[STATUS_TO_COLUMN[task.status]].push(task);
    }
    return groups;
  }, [tasks]);

  if (loading) {
    return (
      <div className="flex h-full flex-1 min-h-0 w-full flex-col items-center justify-center bg-white px-4 py-10 text-zinc-400 dark:bg-[#09090b]">
        <Clock className="h-8 w-8 animate-spin mb-3" />
        <p className="text-sm font-medium">Loading goals and board state...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-1 min-h-0 w-full flex-col items-center justify-center bg-white px-4 py-10 text-center dark:bg-[#09090b]">
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

  if (
    goals.length === 0 &&
    tasks.length === 0 &&
    pendingQuestions.length === 0
  ) {
    return (
      <div className="flex h-full flex-1 min-h-0 w-full flex-col items-center justify-center bg-white px-4 py-10 text-center dark:bg-[#09090b]">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <KanbanSquare className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          No tasks
        </h3>
        <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          Tasks from {scopeLabel} will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 min-w-0 space-y-4 overflow-y-auto bg-white px-4 py-4 dark:bg-[#09090b]">
      <div className="flex flex-col gap-2.5 pb-2.5 border-b border-zinc-100 dark:border-zinc-900/40">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold tracking-wider uppercase text-zinc-400 dark:text-zinc-500 flex items-center gap-2">
            Goals & tasks
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {goals.map((goal) => {
            const isRunning = goal.status === "running";
            const isCompleted = goal.status === "completed";
            return (
              <div key={goal.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isRunning
                      ? "bg-violet-500 animate-pulse"
                      : isCompleted
                        ? "bg-emerald-500"
                        : "bg-zinc-400 dark:bg-zinc-600"
                  }`}
                />
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {goal.title}
                </span>
                {goal.status === "planning" ? (
                  <button
                    onClick={() => handleImplement(goal)}
                    disabled={actionLoading === `implement:${goal.id}`}
                    className="ml-2 inline-flex items-center gap-1 bg-violet-600 hover:bg-violet-500 text-white text-[9px] font-bold px-2 py-0.5 rounded transition shadow-sm disabled:bg-zinc-400"
                  >
                    {actionLoading === `implement:${goal.id}` ? (
                      <Clock className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <PlayCircle className="h-2.5 w-2.5" />
                    )}
                    <span>Implement</span>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {pendingQuestions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          resolving={actionLoading === q.id}
          onAnswer={(option) => handleAnswerQuestion(q.id, option)}
        />
      ))}

      <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4 min-h-0 overflow-y-auto pb-6">
        {COLUMNS.map((col) => {
          const tasksInCol = columnTasks[col.id];
          return (
            <div
              key={col.id}
              onDragOver={(e) => onDragOver(e, col.id)}
              onDragLeave={(e) => onDragLeave(e, col.id)}
              onDrop={() => onDrop(col.id)}
              className={`flex flex-col h-full min-h-[400px] rounded-xl border bg-white p-4 transition-all duration-150 dark:bg-[#09090b] ${dragOverColumn === col.id ? "border-zinc-400 dark:border-zinc-600" : "border-zinc-200/60 dark:border-zinc-800/50"}`}
            >
              <div className="flex items-center justify-between pb-3.5 mb-3.5 border-b border-zinc-200/60 dark:border-zinc-800/60">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {col.label}
                  </span>
                </div>
                <span className="inline-flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900 text-[10px] font-bold px-2 py-0.5 text-zinc-500 dark:text-zinc-400 border border-zinc-200/20 dark:border-zinc-800/20">
                  {tasksInCol.length}
                </span>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto min-h-0 max-h-[600px] pr-1">
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
                        className={`group relative flex flex-col p-4 rounded-xl border bg-white dark:bg-zinc-900 shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.08)] hover:-translate-y-[1px] transition-all duration-200 cursor-grab active:cursor-grabbing ${actionLoading === task.id ? "opacity-50" : ""} border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700`}
                      >
                        {task.dependsOnTaskId && (
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
}
