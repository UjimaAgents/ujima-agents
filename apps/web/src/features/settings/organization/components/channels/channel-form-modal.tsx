"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { ChannelFormFields, normalizeChannelName } from "@/features/team/channel-form-fields";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";

export function ChannelFormModal(props: {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  initialName?: string;
  initialTopic?: string;
  onSubmit: (name: string, topic: string) => Promise<void>;
}) {
  if (!props.isOpen) return null;
  return <ChannelFormModalActive {...props} />;
}

function ChannelFormModalActive({
  onClose,
  mode,
  initialName = "",
  initialTopic = "",
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  initialName?: string;
  initialTopic?: string;
  onSubmit: (name: string, topic: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [topic, setTopic] = useState(initialTopic);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    const trimmedName = normalizeChannelName(name, mode);
    if (!trimmedName) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmedName, topic.trim());
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title={mode === "create" ? "Create channel" : "Edit channel"}
    >
      <div className="space-y-4">
        <ChannelFormFields
          mode={mode}
          name={name}
          description={topic}
          onNameChange={setName}
          onDescriptionChange={setTopic}
          descriptionId="channel-topic"
        />
        {error ? <p className="text-xs text-zinc-600 dark:text-zinc-400">{error}</p> : null}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <SettingsPrimaryButton disabled={saving || !name.trim()} onClick={() => void handleSubmit()}>
            {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </SettingsPrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
