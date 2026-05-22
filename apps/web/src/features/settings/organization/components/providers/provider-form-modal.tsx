"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import {
  PROVIDER_OPTIONS,
  normalizeProviderKey,
  providerLabelFromToken,
} from "@/features/providers/catalog";
import { ProviderCredentialField } from "@/features/providers/provider-credential-field";
import { isOAuthProvider } from "@/features/providers/constants";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";

export function ProviderFormModal(props: {
  isOpen: boolean;
  onClose: () => void;
  usedProviderNames: Set<string>;
  onSave: (name: string, apiKey: string) => Promise<void>;
  mode?: "add" | "update";
  initialName?: string;
}) {
  if (!props.isOpen) return null;
  return <ProviderFormModalActive {...props} />;
}

function ProviderFormModalActive({
  onClose,
  usedProviderNames,
  onSave,
  mode = "add",
  initialName = "",
}: {
  isOpen: boolean;
  onClose: () => void;
  usedProviderNames: Set<string>;
  onSave: (name: string, apiKey: string) => Promise<void>;
  mode?: "add" | "update";
  initialName?: string;
}) {
  const [name, setName] = useState(initialName);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isUpdate = mode === "update";
  const oauth = isOAuthProvider(name);

  const handleClose = () => onClose();

  const handleSave = async () => {
    const normalizedName = normalizeProviderKey(name);
    if (!normalizedName || !apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(normalizedName, apiKey.trim());
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const availableOptions = isUpdate
    ? PROVIDER_OPTIONS.filter((opt) => opt.token === normalizeProviderKey(name))
    : PROVIDER_OPTIONS.filter((opt) => !usedProviderNames.has(opt.token));

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title={isUpdate ? `Update ${providerLabelFromToken(name)}` : "Add provider"}
    >
      <div className="space-y-4">
        <div>
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Provider</label>
          <div className="mt-2">
            {isUpdate ? (
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{providerLabelFromToken(name)}</p>
            ) : (
              <Select
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setApiKey("");
                }}
                placeholder="Select provider"
                options={availableOptions.map((opt) => ({ value: opt.token, label: opt.label }))}
              />
            )}
          </div>
        </div>
        <div>
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {oauth ? "Connection" : "API key"}
          </label>
          {oauth ? (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Sign in with your OpenAI account (Codex subscription).
            </p>
          ) : null}
          <div className="mt-2">
            <ProviderCredentialField
              provider={name}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              onOAuthError={setError}
            />
          </div>
        </div>
        {error ? <p className="text-xs text-zinc-600 dark:text-zinc-400">{error}</p> : null}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <SettingsPrimaryButton disabled={saving || !name || !apiKey.trim()} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save"}
          </SettingsPrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
