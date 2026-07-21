"use client";

import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import { useState, useCallback, useMemo, memo } from "react";
import type { ProviderSecretsUpsertResponse, ProviderStatus } from "@ujima/api-schema";
import { settingsFetch } from "@/features/settings/shared/settings-api";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";
import { SettingsErrorAlert } from "@/features/settings/shared/settings-alert";
import {
  SettingsBadge,
  SettingsGhostIconButton,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from "@/features/settings/shared/settings-buttons";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsList, SettingsListRow, SettingsRowIcon } from "@/features/settings/shared/settings-list-row";
import { SettingsTabActions } from "@/features/settings/shared/settings-layout";
import { normalizeProviderKey, providerLabelFromToken } from "@/features/providers/catalog";
import { credentialStatusLabel } from "@/features/providers/provider-status-copy";
import { ProviderFormModal } from "./providers/provider-form-modal";

export const ProvidersTab = memo(function ProvidersTab({
  orgId,
  providers,
  onProvidersChange,
}: {
  orgId: string;
  providers: ProviderStatus[];
  onProvidersChange: (providers: ProviderStatus[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<ProviderStatus | null>(null);
  const [testingName, setTestingName] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ name: string; ok: boolean; message: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = useMemo(() => providers.filter((p) => p.hasKey), [providers]);
  const usedNames = useMemo(
    () => new Set(configured.map((p) => normalizeProviderKey(p.name))),
    [configured],
  );

  const saveProvider = useCallback(async (name: string, apiKey: string, authMode: "apikey" | "codex" | "claude-code", baseUrl: string) => {
    if (!orgId) return;
    const normalizedName = normalizeProviderKey(name);
    const backendAuthMode = authMode === "codex" ? "chatgpt" : authMode === "claude-code" ? "claude-code" : "apikey";
    const data = await settingsFetch<ProviderSecretsUpsertResponse>(
      "/api/settings/providers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          providerKeys: apiKey ? { [normalizedName]: apiKey } : {},
          providerAuthModes: { [normalizedName]: backendAuthMode },
          providerBaseUrls: { [normalizedName]: baseUrl },
        }),
      },
      "Failed to save provider.",
    );
    onProvidersChange(data.providers);
  }, [orgId, onProvidersChange]);

  const deleteProvider = useCallback(async () => {
    if (!deleteTarget || !orgId) return;
    setDeleting(true);
    try {
      const data = await settingsFetch<ProviderSecretsUpsertResponse>(
        `/api/settings/providers/${encodeURIComponent(deleteTarget)}?organizationId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
        "Failed to delete provider.",
      );
      onProvidersChange(data.providers);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, orgId, onProvidersChange]);

  const testProvider = useCallback(async (name: string) => {
    if (!orgId) return;
    setTestingName(name);
    setTestResult(null);
    try {
      const result = await settingsFetch<{ ok: boolean; message: string }>(
        `/api/settings/providers/${encodeURIComponent(name)}/test?organizationId=${encodeURIComponent(orgId)}`,
        { method: "POST" },
        "Test failed.",
      );
      setTestResult({ name, ok: result.ok, message: result.message });
    } catch {
      setTestResult({ name, ok: false, message: "Test failed." });
    } finally {
      setTestingName(null);
    }
  }, [orgId]);

  return (
    <>
      <SettingsTabActions>
        <SettingsPrimaryButton onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4" />
          Add
        </SettingsPrimaryButton>
      </SettingsTabActions>

      {error ? <SettingsErrorAlert message={error} /> : null}
      {testResult ? (
        <p
          className={`text-sm ${testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-600 dark:text-zinc-400"}`}
        >
          {testResult.ok ? `${providerLabelFromToken(testResult.name)}: Connected` : testResult.message}
        </p>
      ) : null}

      {configured.length === 0 ? (
        <SettingsEmptyState
          icon={Server}
          title="No providers configured"
          description="Add credentials for the LLM providers used by your team."
          action={
            <SettingsPrimaryButton onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4" />
              Add provider
            </SettingsPrimaryButton>
          }
        />
      ) : (
        <SettingsList>
          {configured.map((provider) => {
            const statusLabel = credentialStatusLabel(provider.name, provider.hasKey, provider.authMode);
            const secondary = provider.baseUrl ? `${statusLabel} · ${provider.baseUrl}` : statusLabel;
            return (
              <SettingsListRow
                key={provider.name}
                leading={<SettingsRowIcon icon={Server} />}
                primary={providerLabelFromToken(provider.name)}
                secondary={secondary}
                badge={
                  <SettingsBadge variant={provider.hasKey ? "success" : "warning"}>
                    {provider.hasKey ? (provider.authMode === "chatgpt" ? "Codex" : "Active") : "Needs login"}
                  </SettingsBadge>
                }
                actions={
                  <>
                    <SettingsSecondaryButton
                      disabled={testingName === provider.name}
                      onClick={() => void testProvider(provider.name)}
                    >
                      {testingName === provider.name ? "…" : "Test"}
                    </SettingsSecondaryButton>
                    <SettingsGhostIconButton
                      title="Edit provider"
                      onClick={() => setEditTarget(provider)}
                    >
                      <Pencil className="h-4 w-4" />
                    </SettingsGhostIconButton>
                    <SettingsGhostIconButton
                      title="Remove provider"
                      onClick={() => setDeleteTarget(provider.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </SettingsGhostIconButton>
                  </>
                }
              />
            );
          })}
        </SettingsList>
      )}

      <ProviderFormModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        usedProviderNames={usedNames}
        onSave={saveProvider}
        mode="add"
      />

      <ProviderFormModal
        isOpen={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        usedProviderNames={usedNames}
        onSave={saveProvider}
        mode="update"
        initialName={editTarget?.name ?? ""}
        initialBaseUrl={editTarget?.baseUrl ?? ""}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Remove provider"
        message={`Remove ${deleteTarget ? providerLabelFromToken(deleteTarget) : "this"} credential?`}
        confirmLabel="Remove"
        busy={deleting}
        onConfirm={deleteProvider}
      />
    </>
  );
});
