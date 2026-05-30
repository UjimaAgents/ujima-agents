"use client";

import { useMemo, useState } from "react";
import type { ShellApprovalMode } from "@ujima/shared/browser";
import { normalizeOrgShellApprovalMode } from "@ujima/shared/browser";
import { PolicyApprovalFields } from "@/features/providers/policy-approval-fields";
import { settingsFetchVoid } from "@/features/settings/shared/settings-api";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";

export function PoliciesTab({
  orgId,
  policies,
}: {
  orgId: string;
  policies: {
    requireApprovalForWrites: boolean;
    requireApprovalForShell?: boolean;
    shellApprovalMode?: ShellApprovalMode;
    workspaceBoundaryMode: string;
  };
}) {
  const initialShellMode = normalizeOrgShellApprovalMode(policies);

  const [requireApprovalForWrites, setRequireApprovalForWrites] = useState(
    policies.requireApprovalForWrites,
  );
  const [shellApprovalMode, setShellApprovalMode] = useState<ShellApprovalMode>(initialShellMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const dirty = useMemo(
    () =>
      requireApprovalForWrites !== policies.requireApprovalForWrites ||
      shellApprovalMode !== initialShellMode,
    [requireApprovalForWrites, shellApprovalMode, policies.requireApprovalForWrites, initialShellMode],
  );

  const handleSave = async () => {
    if (!orgId) return;
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      await settingsFetchVoid(
        `/api/orgs/${encodeURIComponent(orgId)}/policies`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            requireApprovalForWrites,
            shellApprovalMode,
          }),
        },
        "Failed to update policies.",
      );
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PolicyApprovalFields
        variant="toggle"
        values={{
          requireApprovalForWrites,
          shellApprovalMode,
        }}
        onChange={(key, value) => {
          if (key === "requireApprovalForWrites") setRequireApprovalForWrites(value);
        }}
        onShellModeChange={setShellApprovalMode}
      />

      {dirty || success || error ? (
        <div className="mt-4 flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          {dirty ? (
            <SettingsPrimaryButton disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save"}
            </SettingsPrimaryButton>
          ) : null}
          {success ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved</span>
          ) : null}
          {error ? (
            <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
