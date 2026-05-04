"use client";

import { Hash, PencilLine, Trash2, Plus } from "lucide-react";
import { useState } from "react";
import { TextInput, TextArea, FieldShell } from "@/components/ui/form-fields";
import type { OrganizationSettingsResponse } from "@ujima/api-schema";

type Channel = NonNullable<OrganizationSettingsResponse["channels"]>[number];

export function ChannelsTab({
  orgId,
  channels,
}: {
  orgId: string;
  channels: Channel[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupChannels = channels.filter((c) => c.kind === "group" || c.kind === "general");

  const startEdit = (channel: Channel) => {
    setEditingId(channel.id);
    setEditName(channel.name);
    setEditTopic(channel.topic ?? "");
  };

  const saveEdit = async (channelId: string) => {
    if (!editName.trim() || !orgId) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(
        `/api/orgs/${encodeURIComponent(orgId)}/channels/${encodeURIComponent(channelId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: editName.trim(), topic: editTopic.trim() }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to update channel.");
      }
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const deleteChannel = async (channelId: string) => {
    if (!confirm("Delete this channel? This cannot be undone.")) return;
    setError(null);
    try {
      const response = await fetch(
        `/api/orgs/${encodeURIComponent(orgId)}/channels/${encodeURIComponent(channelId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to delete channel.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    }
  };

  const createChannel = async () => {
    if (!newName.trim() || !orgId) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/channels`, {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), topic: newTopic.trim() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to create channel.");
      }
      setIsCreating(false);
      setNewName("");
      setNewTopic("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {groupChannels.length} channel{groupChannels.length !== 1 ? "s" : ""}.
        </p>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" />
          Add channel
        </button>
      </div>

      {isCreating ? (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="space-y-4">
            <FieldShell label="Channel name" htmlFor="newChannelName">
              <TextInput
                id="newChannelName"
                value={newName}
                onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                placeholder="new-channel"
              />
            </FieldShell>
            <FieldShell label="Description" htmlFor="newChannelTopic">
              <TextArea
                id="newChannelTopic"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                placeholder="What is this channel for?"
              />
            </FieldShell>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => { setIsCreating(false); setNewName(""); setNewTopic(""); }}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !newName.trim()}
                onClick={createChannel}
                className="rounded-xl bg-violet-600 px-6 py-2 text-sm font-bold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:opacity-50 disabled:shadow-none"
              >
                {saving ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {groupChannels.map((channel) => {
          const isEditing = editingId === channel.id;
          return (
            <div
              key={channel.id}
              className="rounded-2xl border border-zinc-200 px-4 py-4 dark:border-zinc-800"
            >
              {isEditing ? (
                <div className="space-y-4">
                  <FieldShell label="Channel name" htmlFor={`name-${channel.id}`}>
                    <TextInput
                      id={`name-${channel.id}`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </FieldShell>
                  <FieldShell label="Description" htmlFor={`topic-${channel.id}`}>
                    <TextArea
                      id={`topic-${channel.id}`}
                      value={editTopic}
                      onChange={(e) => setEditTopic(e.target.value)}
                    />
                  </FieldShell>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveEdit(channel.id)}
                      className="rounded-xl bg-violet-600 px-6 py-2 text-sm font-bold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:opacity-50 disabled:shadow-none"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 text-zinc-400">
                      <Hash className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{channel.name}</p>
                      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{channel.topic}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(channel)}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      <PencilLine className="h-4 w-4" />
                      Edit
                    </button>
                    {channel.kind !== "general" ? (
                      <button
                        type="button"
                        onClick={() => deleteChannel(channel.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
