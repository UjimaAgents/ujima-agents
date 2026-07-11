"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/form-fields";
import {
  PROVIDER_OPTIONS,
  normalizeProviderKey,
  providerLabelFromToken,
  resolveInternalProviderToken,
  resolveUiProviderToken,
  resolveAuthMode,
  isOpenAIProvider,
  type ProviderAuthModeUI,
} from "@/features/providers/catalog";
import { ProviderCredentialField } from "@/features/providers/provider-credential-field";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";

export function ProviderFormModal(props: {
  isOpen: boolean;
  onClose: () => void;
  usedProviderNames: Set<string>;
  onSave: (name: string, apiKey: string, authMode: ProviderAuthModeUI, baseUrl: string) => Promise<void>;
  mode?: "add" | "update";
  initialName?: string;
  initialBaseUrl?: string;
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
  initialBaseUrl = "",
}: {
  isOpen: boolean;
  onClose: () => void;
  usedProviderNames: Set<string>;
  onSave: (name: string, apiKey: string, authMode: ProviderAuthModeUI, baseUrl: string) => Promise<void>;
  mode?: "add" | "update";
  initialName?: string;
  initialBaseUrl?: string;
}) {
  const [uiProvider, setUiProvider] = useState(resolveUiProviderToken(initialName));
  const [authMode, setAuthMode] = useState<ProviderAuthModeUI>(
    resolveAuthMode(initialName) ?? "apikey",
  );
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [codexConnected, setCodexConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUpdate = mode === "update";

  const internalToken = resolveInternalProviderToken(uiProvider, authMode);
  const isCodexMode = internalToken === "openai-codex";
  const isClaudeCodeMode = internalToken === "anthropic-claude-code";
  const isSubscriptionMode = isCodexMode || isClaudeCodeMode;
  const canSave = Boolean(
    internalToken && (apiKey.trim() || (isSubscriptionMode && codexConnected) || (isUpdate && baseUrl.trim() !== initialBaseUrl.trim())),
  );

  const handleClose = () => onClose();

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(internalToken, apiKey.trim(), authMode, baseUrl.trim());
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const availableOptions = isUpdate
    ? PROVIDER_OPTIONS.filter((opt) => opt.token === resolveUiProviderToken(uiProvider))
    : PROVIDER_OPTIONS.filter((opt) => {
        if (opt.token === "openai") {
          return !usedProviderNames.has("openai") || !usedProviderNames.has("openai-codex");
        }
        return !usedProviderNames.has(opt.token);
      });

  const handleProviderChange = (next: string) => {
    setUiProvider(next);
    setApiKey("");
    setBaseUrl("");
    setCodexConnected(false);
    if (!isOpenAIProvider(next)) setAuthMode("apikey");
  };

  const handleAuthModeChange = (mode: ProviderAuthModeUI) => {
    setAuthMode(mode);
    setCodexConnected(false);
    if (mode === "codex") setBaseUrl("");
  };

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title={isUpdate ? providerLabelFromToken(normalizeProviderKey(initialName)) : "Add provider"}
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

        {uiProvider && !isCodexMode ? (
          <div>
            <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Base URL <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
            </label>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Custom endpoint. Leave blank for default.
            </p>
            <div className="mt-2">
              <TextInput
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://example.com/v1"
                autoComplete="off"
                spellCheck={false}
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
