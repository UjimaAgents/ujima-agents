"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import {
  PROVIDER_OPTIONS,
  normalizeProviderKey,
  providerLabelFromToken,
  resolveInternalProviderToken,
  resolveUiProviderToken,
  resolveAuthMode,
  isOpenAIProvider,
  type OpenAIAuthMode,
} from "@/features/providers/catalog";
import { ProviderCredentialField } from "@/features/providers/provider-credential-field";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";

export function ProviderFormModal(props: {
  isOpen: boolean;
  onClose: () => void;
  usedProviderNames: Set<string>;
  onSave: (name: string, apiKey: string, authMode: OpenAIAuthMode) => Promise<void>;
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
  onSave: (name: string, apiKey: string, authMode: OpenAIAuthMode) => Promise<void>;
  mode?: "add" | "update";
  initialName?: string;
}) {
  // UI dropdown shows "openai" for both openai and openai-codex
  const [uiProvider, setUiProvider] = useState(resolveUiProviderToken(initialName));
  // Auth mode defaults based on the initial name (e.g. editing an existing openai-codex provider)
  const [authMode, setAuthMode] = useState<OpenAIAuthMode>(
    resolveAuthMode(initialName) ?? "apikey",
  );
  const [apiKey, setApiKey] = useState("");
  const [codexConnected, setCodexConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUpdate = mode === "update";

  // The internal token we'll actually save
  const internalToken = resolveInternalProviderToken(uiProvider, authMode);
  const isCodexMode = internalToken === "openai-codex";
  const canSave = Boolean(
    internalToken && (apiKey.trim() || (isCodexMode && codexConnected)),
  );

  const handleClose = () => onClose();

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(internalToken, apiKey.trim(), authMode);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  // In "add" mode, exclude providers already in use.
  // For "openai": hide if BOTH "openai" and "openai-codex" are already used.
  const availableOptions = isUpdate
    ? PROVIDER_OPTIONS.filter((opt) => opt.token === resolveUiProviderToken(uiProvider))
    : PROVIDER_OPTIONS.filter((opt) => {
        if (opt.token === "openai") {
          // Show "OpenAI" if neither openai nor openai-codex is used yet
          return !usedProviderNames.has("openai") || !usedProviderNames.has("openai-codex");
        }
        return !usedProviderNames.has(opt.token);
      });

  const handleProviderChange = (next: string) => {
    setUiProvider(next);
    setApiKey("");
    setCodexConnected(false);
    // Reset auth mode when switching away from OpenAI
    if (!isOpenAIProvider(next)) setAuthMode("apikey");
  };

  const handleAuthModeChange = (mode: OpenAIAuthMode) => {
    setAuthMode(mode);
    setCodexConnected(false);
  };

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title={isUpdate ? `Update ${providerLabelFromToken(uiProvider)}` : "Add provider"}
    >
      <div className="space-y-4">
        <div>
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Provider</label>
          <div className="mt-2">
            {isUpdate ? (
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {providerLabelFromToken(normalizeProviderKey(initialName))}
              </p>
            ) : (
              <Select
                value={uiProvider}
                onChange={(e) => handleProviderChange(e.target.value)}
                placeholder="Select provider"
                options={availableOptions.map((opt) => ({ value: opt.token, label: opt.label }))}
              />
            )}
          </div>
        </div>

        {uiProvider ? (
          <div>
            <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {isOpenAIProvider(uiProvider) ? "Connection" : "API key"}
            </label>
            <div className="mt-2">
              <ProviderCredentialField
                provider={uiProvider}
                apiKey={apiKey}
                onApiKeyChange={setApiKey}
                authMode={authMode}
                onAuthModeChange={isUpdate ? undefined : handleAuthModeChange}
                onCodexConnectionChange={setCodexConnected}
              />
            </div>
          </div>
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
          <SettingsPrimaryButton disabled={saving || !canSave} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save"}
          </SettingsPrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
