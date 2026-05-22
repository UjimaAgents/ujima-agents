"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Play, Pause, Trash2, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";
import { SettingsErrorAlert, SettingsLoading } from "@/features/settings/shared/settings-alert";
import {
  SettingsBadge,
  SettingsGhostIconButton,
  SettingsSecondaryButton,
} from "@/features/settings/shared/settings-buttons";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsList, SettingsListRow, SettingsRowIcon } from "@/features/settings/shared/settings-list-row";
import { SettingsTabActions } from "@/features/settings/shared/settings-layout";

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
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    void fetchSchedules();
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

  const deleteSchedule = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/schedules/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to delete schedule");
      }
      setSchedules((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString();
  };

  const statusVariant = (status: Schedule["status"]) => {
    if (status === "active") return "success" as const;
    if (status === "paused") return "warning" as const;
    if (status === "failed") return "warning" as const;
    return "default" as const;
  };

  if (loading) return <SettingsLoading label="Loading schedules…" />;

  return (
    <>
      <SettingsTabActions>
        <SettingsSecondaryButton onClick={() => void fetchSchedules()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </SettingsSecondaryButton>
      </SettingsTabActions>

      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Create schedules with <code className="rounded bg-zinc-100 px-1 font-mono text-xs dark:bg-zinc-800">/schedule</code> in chat.
      </p>

      {error ? <SettingsErrorAlert message={error} /> : null}

      {schedules.length === 0 && !error ? (
          <SettingsEmptyState
            icon={Clock}
            title="No schedules"
            description="Type /schedule in a channel to create one."
          />
        ) : (
          <SettingsList>
            {schedules.map((schedule) => (
              <SettingsListRow
                key={schedule.id}
                leading={<SettingsRowIcon icon={Clock} />}
                primary={schedule.name}
                secondary={
                  <span className="flex flex-col gap-0.5">
                    <span className="truncate">{schedule.prompt}</span>
                    <span className="font-mono text-[11px]">
                      {schedule.cronExpression} · runs {schedule.runCount} · next {formatDate(schedule.nextRunAt)}
                    </span>
                  </span>
                }
                badge={<SettingsBadge variant={statusVariant(schedule.status)}>{schedule.status}</SettingsBadge>}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => void toggleStatus(schedule)}
                      disabled={schedule.status === "completed"}
                      title={schedule.status === "active" ? "Pause" : "Resume"}
                      className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
                    >
                      {schedule.status === "active" ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </button>
                    <SettingsGhostIconButton
                      title="Delete schedule"
                      onClick={() => setDeleteTarget(schedule)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </SettingsGhostIconButton>
                  </>
                }
              />
            ))}
          </SettingsList>
        )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete schedule"
        message={`Delete "${deleteTarget?.name}"?`}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={deleteSchedule}
      />
    </>
  );
}
