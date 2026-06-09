"use client";

import { Hash, PencilLine, Plus, Trash2 } from "lucide-react";
import { useState, useCallback, useMemo, memo } from "react";
import type { OrganizationSettingsResponse } from "@ujima/api-schema";
import { settingsFetch, settingsFetchVoid } from "@/features/settings/shared/settings-api";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";
import { SettingsErrorAlert } from "@/features/settings/shared/settings-alert";
import {
  SettingsGhostIconButton,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from "@/features/settings/shared/settings-buttons";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsList, SettingsListRow } from "@/features/settings/shared/settings-list-row";
import { SettingsTabActions } from "@/features/settings/shared/settings-layout";
import { ChannelFormModal } from "./channels/channel-form-modal";

type Channel = NonNullable<OrganizationSettingsResponse["channels"]>[number];

export const ChannelsTab = memo(function ChannelsTab({
  orgId,
  channels: initialChannels,
  onChannelsChange,
}: {
  orgId: string;
  channels: Channel[];
  onChannelsChange: (channels: Channel[]) => void;
}) {
  const [channels, setChannels] = useState(initialChannels);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupChannels = useMemo(
    () => channels.filter((c) => c.kind === "group" || c.kind === "general"),
    [channels],
  );

  const updateChannels = useCallback((next: Channel[]) => {
    setChannels(next);
    onChannelsChange(next);
  }, [onChannelsChange]);

  const createChannel = useCallback(async (name: string, topic: string) => {
    if (!orgId) return;
    const created = await settingsFetch<Channel>(
      `/api/orgs/${encodeURIComponent(orgId)}/channels`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, topic }),
      },
      "Failed to create channel.",
    );
    updateChannels([...channels, created]);
  }, [orgId, channels, updateChannels]);

  const saveEdit = useCallback(async (name: string, topic: string) => {
    if (!editingChannel || !orgId) return;
    await settingsFetch(
      `/api/orgs/${encodeURIComponent(orgId)}/channels/${encodeURIComponent(editingChannel.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, topic }),
      },
      "Failed to update channel.",
    );
    updateChannels(
      channels.map((c) =>
        c.id === editingChannel.id ? { ...c, name, topic } : c,
      ),
    );
  }, [editingChannel, orgId, channels, updateChannels]);

  const deleteChannel = useCallback(async () => {
    if (!deleteTarget || !orgId) return;
    setDeleting(true);
    setError(null);
    try {
      await settingsFetchVoid(
        `/api/orgs/${encodeURIComponent(orgId)}/channels/${encodeURIComponent(deleteTarget.id)}`,
        { method: "DELETE" },
        "Failed to delete channel.",
      );
      updateChannels(channels.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, orgId, channels, updateChannels]);

  return (
    <>
      <SettingsTabActions>
        <SettingsPrimaryButton onClick={() => setFormMode("create")}>
          <Plus className="h-4 w-4" />
          Add
        </SettingsPrimaryButton>
      </SettingsTabActions>

      {error ? <SettingsErrorAlert message={error} /> : null}

      {groupChannels.length === 0 ? (
          <SettingsEmptyState
            icon={Hash}
            title="No channels"
            description="Create channels for your team to collaborate."
            action={
              <SettingsPrimaryButton onClick={() => setFormMode("create")}>
                <Plus className="h-4 w-4" />
                Add channel
              </SettingsPrimaryButton>
            }
          />
        ) : (
          <SettingsList>
            {groupChannels.map((channel) => (
              <SettingsListRow
                key={channel.id}
                leading={<Hash className="h-4 w-4 text-zinc-400" />}
                primary={`#${channel.name}`}
                secondary={channel.topic || "—"}
                actions={
                  <>
                    <SettingsSecondaryButton
                      onClick={() => {
                        setEditingChannel(channel);
                        setFormMode("edit");
                      }}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                      Edit
                    </SettingsSecondaryButton>
                    {channel.kind !== "general" ? (
                      <SettingsGhostIconButton
                        title="Delete channel"
                        onClick={() => setDeleteTarget(channel)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </SettingsGhostIconButton>
                    ) : null}
                  </>
                }
              />
            ))}
          </SettingsList>
        )}

      <ChannelFormModal
        isOpen={formMode === "create"}
        onClose={() => setFormMode(null)}
        mode="create"
        onSubmit={createChannel}
      />

      <ChannelFormModal
        isOpen={formMode === "edit" && editingChannel !== null}
        onClose={() => {
          setFormMode(null);
          setEditingChannel(null);
        }}
        mode="edit"
        initialName={editingChannel?.name ?? ""}
        initialTopic={editingChannel?.topic ?? ""}
        onSubmit={saveEdit}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete channel"
        message={`Delete #${deleteTarget?.name}? This cannot be undone.`}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={deleteChannel}
      />
    </>
  );
});
