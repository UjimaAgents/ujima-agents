"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { FieldShell, TextInput } from "@/components/ui/form-fields";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";
import { Select } from "@/components/ui/select";
import { normalizeProviderKey } from "@/features/providers/catalog";

export type DuplicateCopyOptions = {
  providerKeys: string[];
  providerConfigs: boolean;
  agents: boolean;
  roles: boolean;
  channels: boolean;
  tools: boolean;
  policies: boolean;
  orgChart: boolean;
};

export type WorkspaceCreateSubmitInput = {
  name: string;
  rootPath: string;
  sourceWorkspaceId?: string;
  copyProviders?: string[];
  copyOptions?: DuplicateCopyOptions;
};

interface SourceWorkspace {
  id: string;
  label: string | null;
  root_path: string | null;
}

interface WorkspaceRow {
  id: string;
  root_path: string | null;
  label: string | null;
  created_at?: number;
  updated_at?: number;
  is_current?: boolean;
}

const COPY_OPTIONS_LIST = [
  ["agents", "Agents", true],
  ["roles", "Roles (tools, channels, skills, scopes)", true],
  ["channels", "Channels (includes memberships)", false],
  ["tools", "Tools", false],
  ["policies", "Policies", false],
  ["providerConfigs", "Provider configs (baseUrl, models)", false],
  ["orgChart", "Organization chart", false],
] as const;

export function WorkspaceCreateModal(props: {
  isOpen: boolean;
  onClose: () => void;
  configuredProviders: { name: string; hasKey: boolean }[];
  sourceWorkspace?: SourceWorkspace | null;
  workspaces?: WorkspaceRow[];
  onSubmit: (input: WorkspaceCreateSubmitInput) => Promise<void>;
}) {
  if (!props.isOpen) return null;
  return <WorkspaceCreateModalActive {...props} />;
}

function WorkspaceCreateModalActive({
  onClose,
  configuredProviders,
  sourceWorkspace,
  workspaces,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  configuredProviders: { name: string; hasKey: boolean }[];
  sourceWorkspace?: SourceWorkspace | null;
  workspaces?: WorkspaceRow[];
  onSubmit: (input: WorkspaceCreateSubmitInput) => Promise<void>;
}) {
  const isExplicitDuplicate = !!sourceWorkspace;

  const otherWorkspaces = useMemo(
    () => (workspaces ?? []).filter((ws) => ws.id !== sourceWorkspace?.id),
    [workspaces, sourceWorkspace],
  );

  const [duplicateEnabled, setDuplicateEnabled] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [name, setName] = useState(
    sourceWorkspace ? `Copy of ${sourceWorkspace.label ?? sourceWorkspace.id}` : "",
  );
  const [rootPath, setRootPath] = useState(
    sourceWorkspace?.root_path
      ? sourceWorkspace.root_path.replace(/\/+$/, "") + "-copy"
      : "",
  );
  const [saving, setSaving] = useState(false);
  const [isPickingRoot, setIsPickingRoot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rootPickError, setRootPickError] = useState<string | null>(null);
  const [copyKeysEnabled, setCopyKeysEnabled] = useState(false);
  const [selectedProviders, setSelectedProviders] = useState<Record<string, boolean>>({});
  const [copyOptions, setCopyOptions] = useState<Omit<DuplicateCopyOptions, "providerKeys">>({
    providerConfigs: false,
    agents: true,
    roles: true,
    channels: false,
    tools: false,
    policies: false,
    orgChart: false,
  });

  const providersWithKeys = useMemo(
    () =>
      configuredProviders
        .filter((provider) => provider.hasKey)
        .map((provider) => normalizeProviderKey(provider.name)),
    [configuredProviders],
  );

  const effectiveSource = isExplicitDuplicate
    ? sourceWorkspace
    : duplicateEnabled && selectedSourceId
      ? (workspaces ?? []).find((ws) => ws.id === selectedSourceId) ?? null
      : null;

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

    const copyProviders = copyKeysEnabled
      ? providersWithKeys.filter((provider) => selectedProviders[provider] === true)
      : [];

    setSaving(true);
    setError(null);
    try {
      if (effectiveSource) {
        await onSubmit({
          name: trimmedName,
          rootPath: trimmedRoot,
          sourceWorkspaceId: effectiveSource.id,
          copyOptions: {
            ...copyOptions,
            providerKeys: copyProviders,
          },
        });
      } else {
        await onSubmit({
          name: trimmedName,
          rootPath: trimmedRoot,
          copyProviders,
        });
      }
      setError(null);
      setName("");
      setRootPath("");
      setRootPickError(null);
      setCopyKeysEnabled(false);
      setSelectedSourceId("");
      setDuplicateEnabled(false);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace.");
    } finally {
      setSaving(false);
    }
  };

  const title = isExplicitDuplicate ? "Duplicate workspace" : "New workspace";
  const isSubmittingDuplicate = !!effectiveSource;

  return (
    <Modal isOpen onClose={handleClose} title={title} contentClassName="max-w-lg">
      <div className="space-y-4">
        {isExplicitDuplicate && sourceWorkspace ? (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Source: <strong>{sourceWorkspace.label ?? sourceWorkspace.id}</strong>
            {sourceWorkspace.root_path ? (
              <span className="block text-xs text-zinc-400">{sourceWorkspace.root_path}</span>
            ) : null}
          </div>
        ) : null}

        {!isExplicitDuplicate && otherWorkspaces.length > 0 ? (
          <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={duplicateEnabled}
                onChange={(e) => {
                  setDuplicateEnabled(e.target.checked);
                  if (!e.target.checked) setSelectedSourceId("");
                }}
                className="rounded border-zinc-300"
              />
              Duplicate from existing workspace
            </label>
            {duplicateEnabled ? (
              <div className="pl-6">
                <Select
                  value={selectedSourceId}
                  onChange={(e) => {
                    setSelectedSourceId(e.target.value);
                    const ws = otherWorkspaces.find((w) => w.id === e.target.value);
                    if (ws) {
                      setName(`Copy of ${ws.label ?? ws.id}`);
                      setRootPath(
                        ws.root_path ? ws.root_path.replace(/\/+$/, "") + "-copy" : "",
                      );
                    }
                  }}
                  options={[
                    { value: "", label: "Select a workspace…" },
                    ...otherWorkspaces.map((ws) => ({
                      value: ws.id,
                      label: ws.label ?? ws.id,
                    })),
                  ]}
                  placeholder="Select a workspace…"
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <FieldShell label="Workspace name" htmlFor="workspaceName">
          <TextInput
            id="workspaceName"
            type="text"
            placeholder="Acme Product Team"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FieldShell>

        <FieldShell label="Project folder" htmlFor="workspaceRoot">
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

        {providersWithKeys.length > 0 ? (
          <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={copyKeysEnabled}
                onChange={(e) => setCopyKeysEnabled(e.target.checked)}
                className="rounded border-zinc-300"
              />
              Copy API keys
            </label>
            {copyKeysEnabled ? (
              <ul className="space-y-1.5 pl-6">
                {providersWithKeys.map((provider) => (
                  <li key={provider}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                      <input
                        type="checkbox"
                        checked={selectedProviders[provider] ?? false}
                        onChange={(e) =>
                          setSelectedProviders((prev) => ({
                            ...prev,
                            [provider]: e.target.checked,
                          }))
                        }
                        className="rounded border-zinc-300"
                      />
                      {provider}
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {isSubmittingDuplicate ? (
          <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Copy options
            </p>
            <ul className="space-y-1.5">
              {COPY_OPTIONS_LIST.map(([key, label]) => (
                <li key={key}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={copyOptions[key] as boolean}
                      onChange={(e) =>
                        setCopyOptions((prev) => ({ ...prev, [key]: e.target.checked }))
                      }
                      className="rounded border-zinc-300"
                    />
                    {label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

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
            {saving
              ? isSubmittingDuplicate
                ? "Duplicating…"
                : "Creating…"
              : isSubmittingDuplicate
                ? "Duplicate workspace"
                : "Create workspace"}
          </SettingsPrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
