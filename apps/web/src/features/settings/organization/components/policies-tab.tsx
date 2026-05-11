"use client";

import { useState } from "react";

export function PoliciesTab({
  orgId,
  policies,
}: {
  orgId: string;
  policies: { requireApprovalForWrites: boolean; requireApprovalForShell: boolean; workspaceBoundaryMode: string };
}) {
  const [requireApprovalForWrites, setRequireApprovalForWrites] = useState(policies.requireApprovalForWrites);
  const [requireApprovalForShell, setRequireApprovalForShell] = useState(policies.requireApprovalForShell);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    if (!orgId) return;
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      const response = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/policies`, {
        method: "PATCH",
        body: JSON.stringify({
          organizationId: orgId,
          requireApprovalForWrites,
          requireApprovalForShell,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to update policies.");
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Configure the default approval and execution policies for the team.
      </p>

      <div className="space-y-4">
        <label className="flex items-center justify-between rounded-2xl border border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <span>
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">Require approval for writes</span>
            <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
              Agent write operations must be approved before execution.
            </span>
          </span>
          <input
            type="checkbox"
            checked={requireApprovalForWrites}
            onChange={(e) => setRequireApprovalForWrites(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
          />
        </label>

        <label className="flex items-center justify-between rounded-2xl border border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <span>
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">Require approval for shell</span>
            <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
              Shell execution must be reviewed before commands run.
            </span>
          </span>
          <input
            type="checkbox"
            checked={requireApprovalForShell}
            onChange={(e) => setRequireApprovalForShell(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
          />
        </label>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            disabled={saving}
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
    </div>
  );
}
