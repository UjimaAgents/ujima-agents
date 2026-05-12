"use client";

import { CircleUserRound, Mail, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { FieldShell, TextInput } from "@/components/ui/form-fields";
import type { BootstrapResponse } from "@ujima/api-schema";

export function GeneralTab({
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
  onUpdate: (name: string) => void;
}) {
  const [name, setName] = useState(organizationName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !orgId) return;
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      const response = await fetch("/api/settings/organization", {
        method: "PATCH",
        body: JSON.stringify({ organizationId: orgId, organizationName: name.trim() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to update organization name.");
      }
      onUpdate(name.trim());
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <FieldShell label="Organization name" htmlFor="orgName">
          <TextInput
            id="orgName"
            value={name}
            onChange={(e) => { setName(e.target.value); setSuccess(false); }}
            placeholder="Acme Product Team"
          />
        </FieldShell>

        <FieldShell label="Workspace root" htmlFor="workspaceRoot">
          <TextInput
            id="workspaceRoot"
            value={workspaceRoot}
            disabled
            className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900/50 dark:text-zinc-400"
          />
        </FieldShell>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={saving || !name.trim() || name === organizationName}
            onClick={handleSave}
            className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:opacity-50 disabled:shadow-none"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {success ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved</span>
          ) : null}
          {error ? (
            <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
          ) : null}
        </div>
      </div>

      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Owner</p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The owner account for this organization.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <InfoBox icon={CircleUserRound} label="Name" value={auth.member?.name ?? "—"} />
          <InfoBox icon={Mail} label="Email" value={auth.user?.email ?? "—"} />
          <InfoBox icon={ShieldCheck} label="Role" value={auth.member?.roleName ?? "—"} />
        </div>
      </div>
    </div>
  );
}

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
    <div className="rounded-2xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-violet-50 p-2 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
            {label}
          </p>
          <p className="mt-1 break-all text-sm text-zinc-900 dark:text-zinc-100">{value}</p>
        </div>
      </div>
    </div>
  );
}
