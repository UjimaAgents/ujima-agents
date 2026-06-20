"use client";

import { useCallback, useEffect, useRef, useState, memo } from "react";
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

interface Heartbeat {
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

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function statusVariant(status: Heartbeat["status"]) {
  if (status === "active") return "success" as const;
  if (status === "paused") return "warning" as const;
  if (status === "failed") return "warning" as const;
  return "default" as const;
}

export const HeartbeatsTab = memo(function HeartbeatsTab() {
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Heartbeat | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchHeartbeats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/heartbeats");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Unable to fetch heartbeats");
      }
      const data = await res.json();
      setHeartbeats(data.jobs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load heartbeats");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetched = useRef(false);
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    void fetchHeartbeats();
  }, [fetchHeartbeats]);

  const toggleStatus = useCallback(async (heartbeat: Heartbeat) => {
    const nextStatus = heartbeat.status === "active" ? "paused" : "active";
    try {
      const res = await fetch(`/api/heartbeats/${heartbeat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to update heartbeat");
      }
      setHeartbeats((prev) =>
        prev.map((s) => (s.id === heartbeat.id ? { ...s, status: nextStatus as Heartbeat["status"] } : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }, []);

  const deleteHeartbeat = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/heartbeats/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to delete heartbeat");
      }
      setHeartbeats((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget]);

  if (loading) return <SettingsLoading />;

  return (
    <div>
      <SettingsTabActions>
        <SettingsSecondaryButton onClick={() => void fetchHeartbeats()} disabled={loading}>
          <RefreshCw className="w-4 h-4" />
          Refresh
        </SettingsSecondaryButton>
      </SettingsTabActions>

      {error && <SettingsErrorAlert message={error} onDismiss={() => setError(null)} />}

      {heartbeats.length === 0 && !error ? (
        <SettingsEmptyState icon={Clock} title="No heartbeats" description="Heartbeats let agents run periodically and stay silent unless they have updates." />
      ) : (
        <SettingsList>
          {heartbeats.map((heartbeat) => (
            <SettingsListRow
              key={heartbeat.id}
              leading={<SettingsRowIcon icon={Clock} />}
              primary={heartbeat.name}
              badge={<SettingsBadge variant={statusVariant(heartbeat.status)}>{heartbeat.status}</SettingsBadge>}
              secondary={
                <div className="text-sm text-muted-foreground space-y-0.5">
                  <div className="truncate">{heartbeat.prompt}</div>
                  <div className="flex gap-4 text-xs">
                    <span>Cron: {heartbeat.cronExpression}</span>
                    <span>Runs: {heartbeat.runCount}</span>
                    {heartbeat.nextRunAt && <span>Next: {formatDate(heartbeat.nextRunAt)}</span>}
                    {heartbeat.lastRunAt && <span>Last: {formatDate(heartbeat.lastRunAt)}</span>}
                  </div>
                  {heartbeat.lastError && (
                    <div className="text-destructive text-xs truncate" title={heartbeat.lastError}>
                      Error: {heartbeat.lastError}
                    </div>
                  )}
                </div>
              }
              actions={
                <>
                  <SettingsGhostIconButton
                    title={heartbeat.status === "active" ? "Pause" : "Resume"}
                    onClick={() => void toggleStatus(heartbeat)}
                  >
                    {heartbeat.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </SettingsGhostIconButton>
                  <SettingsGhostIconButton
                    title="Delete"
                    onClick={() => setDeleteTarget(heartbeat)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </SettingsGhostIconButton>
                </>
              }
            />
          ))}
        </SettingsList>
      )}

      {deleteTarget && (
        <ConfirmDialog
          isOpen
          title="Delete heartbeat"
          message={`Are you sure you want to delete "${deleteTarget.name}"?`}
          confirmLabel="Delete"
          busy={deleting}
          onConfirm={() => void deleteHeartbeat()}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
});
