"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { FieldShell, TextArea, TextInput } from "@/components/ui/form-fields";
import { Select } from "@/components/ui/select";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";

export interface HeartbeatFormValues {
  name: string;
  cronExpression: string;
  prompt: string;
  channelId: string;
}

const CRON_PRESETS = [
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 9 * * *", label: "Every day at 9:00 AM" },
  { value: "0 9 * * 1-5", label: "Weekdays at 9:00 AM" },
  { value: "0 9 * * 1", label: "Mondays at 9:00 AM" },
  { value: "custom", label: "Custom cron" },
] as const;

function presetForCron(cronExpression: string): string {
  return CRON_PRESETS.some((preset) => preset.value === cronExpression)
    ? cronExpression
    : "custom";
}

export function HeartbeatFormModal({
  isOpen,
  onClose,
  mode,
  channels,
  initialValues,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  channels: Array<{ id: string; name: string }>;
  initialValues: HeartbeatFormValues;
  onSubmit: (values: HeartbeatFormValues) => Promise<void>;
}) {
  if (!isOpen) return null;
  return (
    <HeartbeatFormModalActive
      onClose={onClose}
      mode={mode}
      channels={channels}
      initialValues={initialValues}
      onSubmit={onSubmit}
    />
  );
}

function HeartbeatFormModalActive({
  onClose,
  mode,
  channels,
  initialValues,
  onSubmit,
}: {
  onClose: () => void;
  mode: "create" | "edit";
  channels: Array<{ id: string; name: string }>;
  initialValues: HeartbeatFormValues;
  onSubmit: (values: HeartbeatFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(initialValues.name);
  const [schedulePreset, setSchedulePreset] = useState(presetForCron(initialValues.cronExpression));
  const [cronExpression, setCronExpression] = useState(
    schedulePreset === "custom" ? initialValues.cronExpression : "",
  );
  const [prompt, setPrompt] = useState(initialValues.prompt);
  const [channelId, setChannelId] = useState(initialValues.channelId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const submit = async () => {
    const resolvedCron = schedulePreset === "custom" ? cronExpression.trim() : schedulePreset;
    if (!name.trim() || !resolvedCron || !prompt.trim() || !channelId) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        cronExpression: resolvedCron,
        prompt: prompt.trim(),
        channelId,
      });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save heartbeat.");
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(
    name.trim() &&
      prompt.trim() &&
      channelId &&
      channels.length > 0 &&
      (schedulePreset !== "custom" || cronExpression.trim()),
  );

  return (
    <Modal isOpen onClose={close} title={mode === "create" ? "Create heartbeat" : "Edit heartbeat"}>
      <div className="space-y-4">
        <FieldShell label="Name" htmlFor="heartbeat-name">
          <TextInput id="heartbeat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily check-in" />
        </FieldShell>

        <FieldShell label="Schedule" htmlFor="heartbeat-schedule" hint="Pick a common cadence or use a custom cron.">
          <div className="space-y-3">
            <Select
              id="heartbeat-schedule"
              value={schedulePreset}
              onChange={(e) => setSchedulePreset(e.target.value)}
              placeholder="Select a schedule"
              options={CRON_PRESETS.map((preset) => ({
                value: preset.value,
                label: preset.label,
              }))}
            />
            {schedulePreset === "custom" ? (
              <TextInput
                id="heartbeat-cron"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                placeholder="0 9 * * 1-5"
              />
            ) : null}
          </div>
        </FieldShell>

        <FieldShell label="Prompt" htmlFor="heartbeat-prompt">
          <TextArea
            id="heartbeat-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent do on each run?"
          />
        </FieldShell>

        <FieldShell label="Channel" htmlFor="heartbeat-channel" hint="Pick where this heartbeat should run.">
          <Select
            id="heartbeat-channel"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="Select a channel"
            options={channels.map((channel) => ({
              value: channel.id,
              label: channel.name,
            }))}
          />
        </FieldShell>

        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

        {channels.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Add a channel first.</p>
        ) : null}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={close}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <SettingsPrimaryButton disabled={saving || !canSave} onClick={() => void submit()}>
            {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </SettingsPrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
