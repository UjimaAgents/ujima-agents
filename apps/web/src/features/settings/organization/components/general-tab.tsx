"use client";

import { CircleUserRound, Mail, ShieldCheck } from "lucide-react";
import { useState, useCallback, memo } from "react";
import { FieldShell, TextInput } from "@/components/ui/form-fields";
import type { BootstrapResponse } from "@ujima/api-schema";
import { settingsFetchVoid } from "@/features/settings/shared/settings-api";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";
import { SettingsSection } from "@/features/settings/shared/settings-section";

export const GeneralTab = memo(function GeneralTab({
  orgId,
  auth,
  organizationName,
  workspaceRoot,
  onUpdate,
}: {
  orgId: string;
  auth: BootstrapResponse["auth"];
  organizationName: string;
  workspaceRoot: string;
  onUpdate: (patch: { name?: string; workspaceRoot?: string }) => void;
}) {
  const [name, setName] = useState(organizationName);
  const [root, setRoot] = useState(workspaceRoot);
  const [saving, setSaving] = useState(false);
  const [isPickingRoot, setIsPickingRoot] = useState(false);
  const [rootPickError, setRootPickError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isDirty = name.trim() !== organizationName || root.trim() !== workspaceRoot;

  const pickWorkspaceRoot = useCallback(async () => {
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
        setRoot(body.path);
        setSuccess(false);
      }
    } catch (err) {
      setRootPickError(err instanceof Error ? err.message : "Unable to open folder picker.");
    } finally {
      setIsPickingRoot(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !root.trim() || !orgId || !isDirty) return;
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      await settingsFetchVoid(
        "/api/settings/organization",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            organizationName: name.trim(),
            workspaceRoot: root.trim(),
          }),
        },
        "Failed to update workspace settings.",
      );
      onUpdate({ name: name.trim(), workspaceRoot: root.trim() });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }, [name, root, orgId, isDirty, onUpdate]);

  return (
    <div className="space-y-8">
      <SettingsSection>
        <FieldShell label="Workspace name" htmlFor="orgName">
          <TextInput
            id="orgName"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSuccess(false);
            }}
            placeholder="Acme Product Team"
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
              value={root}
              onChange={(e) => {
                setRoot(e.target.value);
                setSuccess(false);
              }}
              placeholder="/Users/you/projects/my-project"
              className="flex-1 font-mono text-sm"
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

        <div className="flex items-center gap-3">
          <SettingsPrimaryButton
            disabled={saving || !name.trim() || !root.trim() || !isDirty}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </SettingsPrimaryButton>
          {success ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved</span>
          ) : null}
          {error ? (
            <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title="Owner">
        <div className="grid gap-3 sm:grid-cols-3">
          <InfoBox icon={CircleUserRound} label="Name" value={auth.member?.name ?? "—"} />
          <InfoBox icon={Mail} label="Email" value={auth.user?.email ?? "—"} />
          <InfoBox icon={ShieldCheck} label="Role" value={auth.member?.roleName ?? "—"} />
        </div>
      </SettingsSection>
    </div>
  );
});

function InfoBox({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CircleUserRound;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      </div>
      <p className="mt-1 truncate text-sm text-zinc-900 dark:text-zinc-100">{value}</p>
    </div>
  );
}
