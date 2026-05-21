"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clock,
  Play,
  Pause,
  Trash2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

interface Schedule {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  channelId?: string;
  status: "active" | "paused" | "completed" | "failed";
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export function SchedulesTab() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/schedules");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Unable to fetch schedules");
      }
      const data = await res.json();
      setSchedules(data.jobs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetched = useRef(false);
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetchSchedules().catch(() => undefined);
  }, [fetchSchedules]);

  const toggleStatus = async (schedule: Schedule) => {
    const nextStatus = schedule.status === "active" ? "paused" : "active";
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to update schedule");
      }
      setSchedules((prev) =>
        prev.map((s) => (s.id === schedule.id ? { ...s, status: nextStatus as Schedule["status"] } : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  const deleteSchedule = async (id: string) => {
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to delete schedule");
      }
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      setDeleteConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-5 w-5 animate-spin text-zinc-400" />
        <span className="ml-3 text-sm text-zinc-500">Loading schedules...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Manage scheduled jobs. Use <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono dark:bg-zinc-800">/schedule do this</code> in chat to ask the agent to create one.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchSchedules()}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        </div>
      ) : null}

      {schedules.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-16 dark:border-zinc-700 dark:bg-zinc-900/50">
          <Clock className="mb-4 h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">No schedules yet</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Type <code className="rounded bg-zinc-200 px-1 py-0.5 font-mono dark:bg-zinc-800">/schedule standup reminder</code> in a channel to create one.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="flex items-start gap-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {schedule.name}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      schedule.status === "active"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                        : schedule.status === "paused"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                          : schedule.status === "failed"
                            ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        schedule.status === "active"
                          ? "bg-emerald-500"
                          : schedule.status === "paused"
                            ? "bg-amber-500"
                            : schedule.status === "failed"
                              ? "bg-red-500"
                              : "bg-zinc-400"
                      }`}
                    />
                    {schedule.status}
                  </span>
                </div>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {schedule.prompt}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span>
                    Cron: <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">{schedule.cronExpression}</code>
                  </span>
                  <span>Runs: {schedule.runCount}</span>
                  <span>Last: {formatDate(schedule.lastRunAt)}</span>
                  <span>Next: {formatDate(schedule.nextRunAt)}</span>
                  {schedule.lastError ? (
                    <span className="text-red-600 dark:text-red-400" title={schedule.lastError}>
                      Error: {schedule.lastError.slice(0, 60)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void toggleStatus(schedule)}
                  disabled={schedule.status === "completed"}
                  title={schedule.status === "active" ? "Pause" : "Resume"}
                  className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  {schedule.status === "active" ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </button>
                {deleteConfirm === schedule.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void deleteSchedule(schedule.id)}
                      className="rounded-lg bg-red-600 px-2 py-1.5 text-[10px] font-semibold text-white transition hover:bg-red-700"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(schedule.id)}
                    title="Delete"
                    className="rounded-lg p-2 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
