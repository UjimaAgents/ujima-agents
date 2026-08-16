"use client";

import { useEffect, useState, useMemo, useCallback, useRef, memo } from "react";
import {
  AlertTriangle,
  Clock,
  GripVertical,
  KanbanSquare,
  MessageSquare,
  Pencil,
  CheckCircle2,
  Circle,
} from "lucide-react";
import type {
  Goal,
  GoalTask,
  GoalTaskStatus,
  InteractiveQuestion,
} from "@ujima/shared/browser";
import { goalTaskColumnLabel } from "@ujima/shared/browser";
import { Avatar, StatusBadge } from "../chat/primitives";
import { QuestionCard } from "../chat/question-card";
import type { BootstrapResponse } from "@ujima/api-schema";
import { isLiveRun } from "../../feed-selectors";
import { summarizeRunActivity } from "../../lib/run-activity-helpers";
import { clientFetchJson } from "@/lib/client-api";
import { useWorkspaceStore } from "../../workspace-store";

export type ColumnId = "pending" | "in_progress" | "completed";
export type ViewMode = "board" | "list";

export const COLUMNS: { id: ColumnId; label: string; color: string }[] = [
  { id: "pending", label: goalTaskColumnLabel("pending"), color: "bg-amber-500" },
  { id: "in_progress", label: goalTaskColumnLabel("in_progress"), color: "bg-violet-500" },
  { id: "completed", label: goalTaskColumnLabel("completed"), color: "bg-emerald-500" },
];

export const STATUS_TO_COLUMN: Record<GoalTaskStatus, ColumnId> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  blocked: "pending",
  blocked_by_failure: "pending",
  failed: "pending",
  cancelled: "pending",
};

export const COLUMN_TO_STATUS: Record<ColumnId, GoalTaskStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
};

export function isVisibleBoardTask(task: GoalTask): boolean {
  return task.status !== "cancelled";
}

const NUDGE_DEDUP_WINDOW_MS = 10 * 60 * 1000;

function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const NudgeCountdown = memo(function NudgeCountdown({
  lastNudgedAtIso,
}: {
  lastNudgedAtIso: string;
}): JSX.Element | null {
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
    <div className="flex items-center gap-1 mb-2 px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 text-[9px] font-semibold w-fit">
      <Clock className="h-3 w-3 shrink-0" />
      <span>Next nudge in {formatMmSs(remaining)}</span>
    </div>
  );
});

function TaskActivityLine({ assigneeId }: { assigneeId: string }) {
  const activeRuns = useWorkspaceStore((state) => state.globalActiveRuns);
  const activity = useWorkspaceStore((state) => state.activity);
  const summary = useMemo(() => {
    let latest: (typeof activeRuns)[number] | undefined;
    for (const run of activeRuns) {
      if (!isLiveRun(run) || run.agentId !== assigneeId) continue;
      if (!latest || Date.parse(run.startedAt) > Date.parse(latest.startedAt)) latest = run;
    }
    if (!latest) return null;
    return summarizeRunActivity(latest, activity);
  }, [activeRuns, activity, assigneeId]);

  if (!summary) return null;
  const hasOps = summary.recentOperations.length > 0;

  return (
    <div className="mb-2 flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
        <span className="truncate">{summary.latestOperation || summary.summary}</span>
        <StatusBadge variant={summary.statusBadge.variant} label={summary.statusBadge.label} />
      </div>
      {hasOps && summary.recentOperations.length > 0 ? (
        <div className="flex flex-wrap gap-1 pl-3">
          {summary.recentOperations.map((op, i) => (
            <span
              key={i}
              className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] font-mono text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {op}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface TaskCardProps {
  task: GoalTask;
  depTask: GoalTask | null | undefined;
  isBlocked: boolean;
  assigneeName: string;
  actionLoading: boolean;
  members: BootstrapResponse["members"];
  refresh: () => Promise<void>;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
}

export function TaskCard({
  task,
  depTask,
  isBlocked,
  assigneeName,
  actionLoading,
  members,
  refresh,
  onDragStart,
  onDragEnd,
}: TaskCardProps) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editAssigneeId, setEditAssigneeId] = useState(task.assigneeId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (editTitle.trim().length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await clientFetchJson(`/api/goal-tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle !== task.title ? editTitle : undefined,
          assigneeId: editAssigneeId !== task.assigneeId ? editAssigneeId : undefined,
        }),
      }, "Failed to update task.");
      setEditing(false);
      await refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to update task.");
    } finally {
      setSaving(false);
    }
  }, [task, editTitle, editAssigneeId, refresh]);

  return (
    <div
      draggable
      onDragStart={() => onDragStart(task.id)}
      onDragEnd={onDragEnd}
      className={`group relative flex flex-col p-4 rounded-xl border bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md hover:-translate-y-[1px] transition-all duration-200 cursor-grab active:cursor-grabbing ${
        actionLoading ? "opacity-50 pointer-events-none" : ""
      } border-zinc-200 dark:border-zinc-800 hover:border-violet-500/50 dark:hover:border-violet-500/50 ${
        isBlocked
          ? "border-l-4 border-l-red-500 bg-gradient-to-r from-red-500/[0.03] to-transparent dark:from-red-500/[0.05]"
          : task.dependsOnTaskId && task.status !== "completed" && task.status !== "in_progress"
            ? "border-l-4 border-l-amber-500 bg-gradient-to-r from-amber-500/[0.03] to-transparent dark:from-amber-500/[0.05]"
            : task.status === "completed"
              ? "opacity-90 hover:opacity-100"
              : ""
      }`}
    >
      <button
        type="button"
        onClick={() => {
          setEditTitle(task.title);
          setEditAssigneeId(task.assigneeId);
          setEditing(true);
        }}
        className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 focus:opacity-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
        title="Edit task"
      >
        <Pencil className="h-3 w-3" />
      </button>

      {editing ? (
        <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            autoFocus
            placeholder="Task title"
          />
          <select
            value={editAssigneeId}
            onChange={(e) => setEditAssigneeId(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2 justify-end mt-1">
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-2 py-1 text-[10px] font-semibold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || editTitle.trim().length === 0}
              className="rounded-md bg-violet-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
          {saveError ? <p className="text-[10px] text-red-600">{saveError}</p> : null}
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2 pr-6 pt-0.5">
            <h4
              className={`text-xs font-semibold leading-relaxed mb-3 ${
                task.status === "completed"
                  ? "line-through text-zinc-400 dark:text-zinc-500"
                  : "text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {task.title}
            </h4>
          </div>

          {task.status === "in_progress" ? <TaskActivityLine assigneeId={task.assigneeId} /> : null}

          {isBlocked && depTask && (
            <div
              className="flex items-center gap-1 mb-2 px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300 text-[10px] font-semibold cursor-help"
              title={`Depends on: ${depTask.title}`}
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">Blocked by: {depTask.title}</span>
            </div>
          )}
          {isBlocked && !depTask && (
            <div className="flex items-center gap-1 mb-2 px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300 text-[10px] font-semibold">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>Blocked</span>
            </div>
          )}

          {task.status === "pending" && task.lastNudgedAt && (
            <NudgeCountdown lastNudgedAtIso={task.lastNudgedAt} />
          )}

          <div className="flex items-center justify-between mt-auto pt-3 border-t border-zinc-100 dark:border-zinc-800/60">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Avatar name={assigneeName} size="xs" />
              <span className="truncate text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                {assigneeName}
              </span>
              {task.handoverSummary && (
                <div
                  className="text-zinc-400 dark:text-zinc-500 cursor-help shrink-0"
                  title={task.handoverSummary}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-400 dark:group-hover:text-zinc-500 transition-colors" />
          </div>
        </>
      )}
    </div>
  );
}

export interface GoalTaskBoardProps {
  tasks: GoalTask[];
  questions?: InteractiveQuestion[];
  members: BootstrapResponse["members"];
  viewMode?: ViewMode;
  searchQuery?: string;
  actionLoading?: string | null;
  refresh: () => Promise<void>;
  onUpdateStatus: (task: GoalTask, newStatus: GoalTaskStatus) => void;
  onAnswerQuestion?: (questionId: string, option: string) => void;
}

export function GoalTaskBoard({
  tasks,
  questions = [],
  members,
  viewMode = "board",
  searchQuery = "",
  actionLoading = null,
  refresh,
  onUpdateStatus,
  onAnswerQuestion,
}: GoalTaskBoardProps) {
  const dragTaskId = useRef<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);

  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members]
  );
  const taskById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks]
  );

  const filteredTasks = useMemo(() => {
    let result = tasks.filter(isVisibleBoardTask);
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) => {
        const titleMatch = t.title.toLowerCase().includes(q);
        const assignee = memberById.get(t.assigneeId)?.name?.toLowerCase() ?? "";
        return titleMatch || assignee.includes(q);
      });
    }
    return result;
  }, [tasks, searchQuery, memberById]);

  const columnTasks = useMemo(() => {
    const groups: Record<ColumnId, GoalTask[]> = {
      pending: [],
      in_progress: [],
      completed: [],
    };
    for (const task of filteredTasks) {
      const col = STATUS_TO_COLUMN[task.status] ?? "pending";
      groups[col].push(task);
    }
    return groups;
  }, [filteredTasks]);

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
    const { clientX, clientY } = e;
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
      onUpdateStatus(task, newStatus);
    },
    [tasks, onUpdateStatus]
  );

  if (viewMode === "list") {
    return (
      <div className="flex flex-col flex-1 min-h-0 w-full p-4 overflow-y-auto">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden shadow-sm">
          <div className="grid grid-cols-[auto_1fr_160px_140px] items-center gap-4 px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            <span className="w-5" />
            <span>Task</span>
            <span>Assignee</span>
            <span>Status</span>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {filteredTasks.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-400">
                No matching tasks found.
              </div>
            ) : (
              filteredTasks.map((task) => {
                const assigneeName = memberById.get(task.assigneeId)?.name ?? "Unassigned";
                const isBlocked =
                  task.status === "blocked" ||
                  task.status === "blocked_by_failure" ||
                  (task.dependsOnTaskId != null &&
                    taskById.get(task.dependsOnTaskId)?.status !== "completed");
                return (
                  <div
                    key={task.id}
                    className="grid grid-cols-[auto_1fr_160px_140px] items-center gap-4 px-4 py-3 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors text-xs"
                  >
                    <button
                      onClick={() =>
                        onUpdateStatus(
                          task,
                          task.status === "completed" ? "pending" : "completed"
                        )
                      }
                      className="text-zinc-400 hover:text-emerald-500 transition-colors"
                    >
                      {task.status === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <p
                        className={`font-semibold ${
                          task.status === "completed"
                            ? "line-through text-zinc-400 dark:text-zinc-500"
                            : "text-zinc-900 dark:text-zinc-100"
                        }`}
                      >
                        {task.title}
                      </p>
                      {isBlocked && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-red-500 mt-0.5">
                          <AlertTriangle className="h-3 w-3" /> Blocked
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar name={assigneeName} size="xs" />
                      <span className="truncate text-zinc-600 dark:text-zinc-400 font-medium">
                        {assigneeName}
                      </span>
                    </div>
                    <div>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                          task.status === "completed"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : task.status === "in_progress"
                              ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                        }`}
                      >
                        {task.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
      {questions.length > 0 && onAnswerQuestion && (
        <div className="p-4 pb-0 shrink-0">
          <div className="space-y-3">
            {questions.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                onAnswer={(id, opt) => onAnswerQuestion(id, opt)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 flex-1 min-h-0 overflow-y-auto">
        {COLUMNS.map((col) => {
          const colTasksList = columnTasks[col.id];
          const isOver = dragOverColumn === col.id;

          return (
            <div
              key={col.id}
              onDragOver={(e) => onDragOver(e, col.id)}
              onDragLeave={(e) => onDragLeave(e, col.id)}
              onDrop={() => onDrop(col.id)}
              className={`flex flex-col rounded-xl border p-3 bg-zinc-50/50 dark:bg-zinc-900/30 transition-colors min-h-[300px] ${
                isOver
                  ? "border-violet-500 bg-violet-500/[0.04] dark:bg-violet-500/[0.06]"
                  : "border-zinc-200/80 dark:border-zinc-800/80"
              }`}
            >
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${col.color}`} />
                  <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
                    {col.label}
                  </h3>
                </div>
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-zinc-200/70 px-1.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {colTasksList.length}
                </span>
              </div>

              <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto pr-0.5">
                {colTasksList.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-6 text-center text-xs font-medium text-zinc-400">
                    Empty column
                  </div>
                ) : (
                  colTasksList.map((task) => {
                    const assigneeName = memberById.get(task.assigneeId)?.name ?? "Unassigned";
                    const isBlocked =
                      task.status === "blocked" ||
                      task.status === "blocked_by_failure" ||
                      (task.dependsOnTaskId != null &&
                        taskById.get(task.dependsOnTaskId)?.status !== "completed");
                    const depTask = task.dependsOnTaskId ? taskById.get(task.dependsOnTaskId) : null;

                    return (
                      <TaskCard
                        key={task.id}
                        task={task}
                        depTask={depTask}
                        isBlocked={isBlocked}
                        assigneeName={assigneeName}
                        actionLoading={actionLoading === task.id}
                        members={members}
                        refresh={refresh}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                      />
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
