"use client";

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { ArrowUpRight, Clock, PencilLine, Pause, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";
import { SettingsErrorAlert, SettingsLoading } from "@/features/settings/shared/settings-alert";
import {
  SettingsBadge,
  SettingsGhostIconButton,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from "@/features/settings/shared/settings-buttons";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsList, SettingsListRow, SettingsRowIcon } from "@/features/settings/shared/settings-list-row";
import { SettingsTabActions } from "@/features/settings/shared/settings-layout";
import { useSettingsPage } from "@/features/settings/shared/settings-workspace-context";
import { visibleWorkspaceChannels } from "@/features/workspace/workspace-channels";
import {
  HeartbeatFormModal,
  type HeartbeatFormValues,
} from "./heartbeats/heartbeat-form-modal";

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

type HeartbeatFormState =
  | { mode: "create" }
  | { mode: "edit"; heartbeat: Heartbeat }
  | null;

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
  const router = useRouter();
  const { channels } = useSettingsPage();
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Heartbeat | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [formState, setFormState] = useState<HeartbeatFormState>(null);

  const availableChannels = useMemo(
    () => visibleWorkspaceChannels(channels).map((channel) => ({ id: channel.id, name: channel.name })),
    [channels],
  );
  const channelNameById = useMemo(
    () => new Map(availableChannels.map((channel) => [channel.id, channel.name])),
    [availableChannels],
  );

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

  const saveHeartbeat = useCallback(
    async (values: HeartbeatFormValues) => {
      const active = formState;
      const endpoint = active?.mode === "edit" ? `/api/heartbeats/${active.heartbeat.id}` : "/api/heartbeats";
      const method = active?.mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Failed to ${active?.mode === "edit" ? "update" : "create"} heartbeat`);
      }
      await fetchHeartbeats();
    },
    [fetchHeartbeats, formState],
  );

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
      await fetchHeartbeats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }, [fetchHeartbeats]);

  const deleteHeartbeat = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/heartbeats/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to delete heartbeat");
      }
      setDeleteTarget(null);
      await fetchHeartbeats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, fetchHeartbeats]);

  if (loading) return <SettingsLoading />;

  return (
    <div>
      <SettingsTabActions>
        <SettingsSecondaryButton onClick={() => void fetchHeartbeats()} disabled={loading}>
          <RefreshCw className="w-4 h-4" />
          Refresh
        </SettingsSecondaryButton>
        <SettingsPrimaryButton
          disabled={availableChannels.length === 0}
          onClick={() => setFormState({ mode: "create" })}
        >
          <Plus className="w-4 h-4" />
          Add heartbeat
        </SettingsPrimaryButton>
      </SettingsTabActions>

      {error && <SettingsErrorAlert message={error} onDismiss={() => setError(null)} />}

      {heartbeats.length === 0 && !error ? (
        <SettingsEmptyState
          icon={Clock}
          title="No heartbeats"
          description="Add a heartbeat to keep an agent checking in on a channel."
        />
      ) : (
        <SettingsList>
          {heartbeats.map((heartbeat) => {
            const channelName = heartbeat.channelId
              ? channelNameById.get(heartbeat.channelId) ?? heartbeat.channelId
              : "—";

            return (
              <SettingsListRow
                key={heartbeat.id}
                leading={<SettingsRowIcon icon={Clock} />}
                primary={heartbeat.name}
                badge={<SettingsBadge variant={statusVariant(heartbeat.status)}>{heartbeat.status}</SettingsBadge>}
                secondary={
                  <div className="space-y-0.5 text-sm text-muted-foreground">
                    <div className="truncate">{heartbeat.prompt}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span>Channel: {channelName}</span>
                      <span>Cron: {heartbeat.cronExpression}</span>
                      <span>Runs: {heartbeat.runCount}</span>
                      {heartbeat.nextRunAt && <span>Next: {formatDate(heartbeat.nextRunAt)}</span>}
                      {heartbeat.lastRunAt && <span>Last: {formatDate(heartbeat.lastRunAt)}</span>}
                    </div>
                    {heartbeat.lastError ? (
                      <div className="truncate text-xs text-destructive" title={heartbeat.lastError}>
                        Error: {heartbeat.lastError}
                      </div>
                    ) : null}
                  </div>
                }
                actions={
                  <>
                    <SettingsGhostIconButton
                      title="Open trace"
                      disabled={!heartbeat.channelId}
                      onClick={() => {
                        if (!heartbeat.channelId) return;
                        router.push(`/workspace?channelId=${encodeURIComponent(heartbeat.channelId)}`);
                      }}
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </SettingsGhostIconButton>
                    <SettingsGhostIconButton
                      title="Edit"
                      onClick={() => setFormState({ mode: "edit", heartbeat })}
                    >
                      <PencilLine className="w-4 h-4" />
                    </SettingsGhostIconButton>
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
            );
          })}
        </SettingsList>
      )}

      <HeartbeatFormModal
        isOpen={formState !== null}
        onClose={() => setFormState(null)}
        mode={formState?.mode ?? "create"}
        channels={availableChannels}
        initialValues={
          formState?.mode === "edit"
            ? {
                name: formState.heartbeat.name,
                cronExpression: formState.heartbeat.cronExpression,
                prompt: formState.heartbeat.prompt,
                channelId: formState.heartbeat.channelId ?? "",
              }
            : { name: "", cronExpression: "", prompt: "", channelId: "" }
        }
        onSubmit={saveHeartbeat}
      />

      {deleteTarget ? (
        <ConfirmDialog
          isOpen
          title="Delete heartbeat"
          message={`Are you sure you want to delete "${deleteTarget.name}"?`}
          confirmLabel="Delete"
          busy={deleting}
          onConfirm={() => void deleteHeartbeat()}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
});
