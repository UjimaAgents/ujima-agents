"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, Clock, Loader2, OctagonAlert, Square, XCircle } from "lucide-react";

/**
 * Per-channel Tasks tab.
 *
 * Distinct from the inline [[channel-goals-strip]] that lives in the
 * channel header: the strip is the at-a-glance read-only rail (open +
 * recently-completed only), this tab is the full management surface —
 * every status, sortable, with human-driven status overrides.
 *
 * Powered by `GET /api/channels/:id/tasks` for the list and
 * `PATCH /api/channels/:id/tasks/:todoId/status` for the mutation.
 * Both proxy through Next.js → daemon so the bearer token lives in an
 * httpOnly cookie and the agent never sees a writable token. The
 * mutation emits `commitment:updated` server-side; we also optimistic-
 * update so the UI responds before the socket round-trips.
 */

interface ChannelTask {
  id: string;
  memberId: string;
  title: string;
  status: TaskStatus;
  notes?: string;
  channelId?: string;
  sourceMessageId?: string;
  deliverableSummary?: string;
  dueAt?: string;
  lastProgressAt?: string;
  emptyWakeCount?: number;
  createdAt: string;
  updatedAt: string;
}

type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "blocked"
  | "expired";

const STATUS_ORDER: TaskStatus[] = [
  "in_progress",
  "pending",
  "blocked",
  "completed",
  "expired",
  "cancelled",
];

const STATUS_LABEL: Record<TaskStatus, string> = {
  in_progress: "In progress",
  pending: "Pending",
  blocked: "Blocked",
  completed: "Completed",
  expired: "Expired",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<TaskStatus, string> = {
  in_progress:
    "border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100",
  pending:
    "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200",
  blocked:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
  completed:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  expired:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  cancelled:
    "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500",
};

interface ChannelTasksResponse {
  todos: ChannelTask[];
}

export function ChannelTasksTab({
  organizationId,
  channelId,
  memberNameLookup,
}: {
  organizationId: string;
  channelId: string;
  memberNameLookup: (memberId: string) => string | undefined;
}): JSX.Element {
  const [tasks, setTasks] = useState<ChannelTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!organizationId || !channelId) return;
    inflightRef.current?.abort();
    const ac = new AbortController();
    inflightRef.current = ac;
    try {
      const res = await fetch(
        `/api/channels/${encodeURIComponent(channelId)}/tasks?organizationId=${encodeURIComponent(organizationId)}`,
        { signal: ac.signal },
      );
      if (!res.ok) {
        setError(`Tasks unavailable (${res.status})`);
        setLoading(false);
        return;
      }
      const body = (await res.json()) as ChannelTasksResponse;
      setTasks(body.todos ?? []);
      setError(null);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load channel tasks.");
    } finally {
      setLoading(false);
    }
  }, [channelId, organizationId]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    // Polling cadence matches the goals strip — cheap join, 15s feels
    // live without thrashing. Server-driven socket updates would land
    // sooner but the poll is the safety net.
    const interval = setInterval(() => void refresh(), 15_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      inflightRef.current?.abort();
    };
  }, [refresh]);

  const grouped = useMemo(() => {
    const map = new Map<TaskStatus, ChannelTask[]>();
    for (const status of STATUS_ORDER) map.set(status, []);
    for (const task of tasks) {
      const bucket = map.get(task.status) ?? [];
      bucket.push(task);
      map.set(task.status, bucket);
    }
    return map;
  }, [tasks]);

  const counts = useMemo(() => {
    return STATUS_ORDER.map((status) => ({
      status,
      count: grouped.get(status)?.length ?? 0,
    }));
  }, [grouped]);

  const updateStatus = useCallback(
    async (task: ChannelTask, status: TaskStatus) => {
      if (task.status === status) return;
      setPendingId(task.id);
      // Optimistic update — the server will emit commitment:updated
      // and the next poll/socket tick will reconcile if anything
      // diverges.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, status, lastProgressAt: new Date().toISOString() }
            : t,
        ),
      );
      try {
        const res = await fetch(
          `/api/channels/${encodeURIComponent(channelId)}/tasks/${encodeURIComponent(task.id)}/status`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ organizationId, status }),
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(
            (body as { message?: string } | null)?.message ?? `Failed (${res.status})`,
          );
        }
        // Reconcile with server payload (gets the new updatedAt).
        const body = (await res.json()) as { todo: ChannelTask };
        setTasks((prev) => prev.map((t) => (t.id === body.todo.id ? body.todo : t)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update task.");
        // Roll back optimism.
        await refresh();
      } finally {
        setPendingId(null);
      }
    },
    [channelId, organizationId, refresh],
  );

  if (loading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center px-3 py-8 text-xs text-zinc-500 dark:text-zinc-400">
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        Loading tasks…
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
        No tasks recorded for this channel yet. Agents create tasks automatically when they commit
        to deliverables (e.g. {`"I will draft the BRD"`}) or deliver work (e.g. {`"I have written the spec to docs/spec.md"`}).
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      {error ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {counts
          .filter((c) => c.count > 0)
          .map(({ status, count }) => (
            <span
              key={status}
              className={`rounded-md border px-2 py-0.5 font-medium ${STATUS_TONE[status]}`}
            >
              {count} {STATUS_LABEL[status].toLowerCase()}
            </span>
          ))}
      </div>

      <div className="flex flex-col gap-3">
        {STATUS_ORDER.map((status) => {
          const items = grouped.get(status) ?? [];
          if (items.length === 0) return null;
          return (
            <section key={status} className="flex flex-col gap-1.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {STATUS_LABEL[status]}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {items.map((task) => {
                  const ownerName = memberNameLookup(task.memberId) ?? task.memberId;
                  const isPending = pendingId === task.id;
                  const isTerminal = task.status === "completed" || task.status === "cancelled" || task.status === "expired";
                  return (
                    <li
                      key={task.id}
                      className={`flex flex-col gap-1 rounded-md border px-3 py-2 ${STATUS_TONE[task.status]}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">
                              {ownerName}
                            </span>
                            {task.emptyWakeCount && task.emptyWakeCount > 0 ? (
                              <span
                                className="rounded bg-amber-200/60 px-1 text-[9px] font-semibold uppercase text-amber-900 dark:bg-amber-900/60 dark:text-amber-200"
                                title={`Owner has woken ${task.emptyWakeCount} time(s) without publishing progress`}
                              >
                                {task.emptyWakeCount} empty wake{task.emptyWakeCount === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </div>
                          <p className="break-words text-xs font-medium">
                            {task.deliverableSummary ?? task.title}
                          </p>
                          {task.notes && task.notes !== task.deliverableSummary ? (
                            <p className="break-words text-[10px] opacity-70">{task.notes}</p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-2 text-[10px] opacity-70">
                            {task.dueAt ? (
                              <span className="flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                {formatDue(task.dueAt)}
                              </span>
                            ) : null}
                            {task.lastProgressAt ? <span>last activity {formatAge(task.lastProgressAt)}</span> : null}
                            <span>created {formatAge(task.createdAt)}</span>
                          </div>
                        </div>
                        {!isTerminal ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => void updateStatus(task, "completed")}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900"
                              title="Mark complete"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Done
                            </button>
                            {task.status !== "blocked" ? (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => void updateStatus(task, "blocked")}
                                className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-800 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200 dark:hover:bg-rose-900"
                                title="Mark blocked"
                              >
                                <OctagonAlert className="h-3 w-3" />
                                Block
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => void updateStatus(task, "cancelled")}
                              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[10px] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                              title="Cancel task"
                            >
                              <XCircle className="h-3 w-3" />
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center">
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => void updateStatus(task, "in_progress")}
                              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[10px] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                              title="Reopen task"
                            >
                              <Circle className="h-3 w-3" />
                              Reopen
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function formatDue(dueIso: string): string {
  const due = new Date(dueIso).getTime();
  if (!Number.isFinite(due)) return "";
  const diff = due - Date.now();
  if (diff <= 0) return "overdue";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `due in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `due in ${hours}h`;
  const days = Math.round(hours / 24);
  return `due in ${days}d`;
}

function formatAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const minutes = Math.round((Date.now() - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Lint helpers — keep optional icons referenced even when not rendered.
void Square;
