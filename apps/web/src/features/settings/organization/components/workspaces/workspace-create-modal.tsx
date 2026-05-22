"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { FieldShell, TextInput } from "@/components/ui/form-fields";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";

export function WorkspaceCreateModal(props: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, rootPath: string) => Promise<void>;
}) {
  if (!props.isOpen) return null;
  return <WorkspaceCreateModalActive {...props} />;
}

function WorkspaceCreateModalActive({
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, rootPath: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [isPickingRoot, setIsPickingRoot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rootPickError, setRootPickError] = useState<string | null>(null);

  const handleClose = () => {
    setError(null);
    setRootPickError(null);
    onClose();
  };

  const pickWorkspaceRoot = async () => {
    setRootPickError(null);
    setIsPickingRoot(true);
    try {
      const response = await fetch("/api/onboarding/pick-workspace-root", { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { path?: string; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(body?.message ?? "Unable to open folder picker.");
      }

      if (body?.path) {
        setRootPath(body.path);
      }
    } catch (err) {
      setRootPickError(err instanceof Error ? err.message : "Unable to open folder picker.");
    } finally {
      setIsPickingRoot(false);
    }
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedRoot = rootPath.trim();
    if (!trimmedName || !trimmedRoot) return;

    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmedName, trimmedRoot);
      setName("");
      setRootPath("");
      setRootPickError(null);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={handleClose} title="New workspace" contentClassName="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Creates a new organization/project context with its own starter team and folder.
        </p>

        <FieldShell label="Workspace name" htmlFor="workspaceName">
          <TextInput
            id="workspaceName"
            type="text"
            placeholder="Acme Product Team"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FieldShell>

        <FieldShell
          label="Project folder"
          htmlFor="workspaceRoot"
          hint="Browse opens a native folder dialog when this app runs on your machine (local dev)."
        >
          <div className="flex gap-2">
            <TextInput
              id="workspaceRoot"
              type="text"
              placeholder="/Users/you/projects/my-project"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => void pickWorkspaceRoot()}
              disabled={isPickingRoot}
              className="shrink-0 rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {isPickingRoot ? "Opening…" : "Browse"}
            </button>
          </div>
        </FieldShell>

        {rootPickError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{rootPickError}</p>
        ) : null}
        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <SettingsPrimaryButton
            disabled={saving || !name.trim() || !rootPath.trim()}
            onClick={() => void handleSubmit()}
          >
            {saving ? "Creating…" : "Create workspace"}
          </SettingsPrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
