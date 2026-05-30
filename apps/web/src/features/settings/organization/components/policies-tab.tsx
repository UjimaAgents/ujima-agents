"use client";

import { AlertTriangle, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ShellApprovalMode } from "@ujima/shared/browser";
import { normalizeOrgShellApprovalMode } from "@ujima/shared/browser";
import type { PolicyAllowRule } from "@ujima/api-schema";
import { Skeleton } from "@/components/ui/skeleton";
import { PolicyApprovalFields } from "@/features/providers/policy-approval-fields";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";
import { settingsFetch, settingsFetchVoid } from "@/features/settings/shared/settings-api";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsPrimaryButton, SettingsSecondaryButton } from "@/features/settings/shared/settings-buttons";
import { SettingsSection } from "@/features/settings/shared/settings-section";

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

  // --- Policy records state ---
  const [rules, setRules] = useState<PolicyAllowRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<PolicyAllowRule | null>(null);
  const [revoking, setRevoking] = useState(false);

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

  // --- Fetch allow rules ---
  const fetchRules = useCallback(async () => {
    if (!orgId) return;
    setRulesLoading(true);
    setRulesError(null);
    try {
      const data = await settingsFetch<{ rules: PolicyAllowRule[] }>(
        `/api/orgs/${encodeURIComponent(orgId)}/policies/rules`,
        { method: "GET" },
        "Failed to load policy records.",
      );
      setRules(data.rules ?? []);
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : "Failed to load.");
      setRules([]);
    } finally {
      setRulesLoading(false);
    }
  }, [orgId]);

  // Fetch on mount using promise chain to avoid sync setState lint
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    // Initial state is loading=true; only setState in promise callbacks
    settingsFetch<{ rules: PolicyAllowRule[] }>(
      `/api/orgs/${encodeURIComponent(orgId)}/policies/rules`,
      { method: "GET" },
      "Failed to load policy records.",
    )
      .then((data) => {
        if (!cancelled) {
          setRules(data.rules ?? []);
          setRulesLoading(false);
          setRulesError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRulesError(err instanceof Error ? err.message : "Failed to load.");
          setRules([]);
          setRulesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // --- Revoke an allow rule ---
  const handleRevoke = async () => {
    if (!orgId || !revokeTarget) return;
    setRevoking(true);
    setRulesError(null);
    const target = revokeTarget;
    // Optimistic removal
    setRules((prev) =>
      prev.filter(
        (r) =>
          !(
            r.agentId === target.agentId &&
            r.mcpId === target.mcpId &&
            r.toolName === target.toolName
          ),
      ),
    );
    setRevokeTarget(null);
    try {
      await settingsFetchVoid(
        `/api/orgs/${encodeURIComponent(orgId)}/policies/rules`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: target.agentId,
            mcpId: target.mcpId,
            toolName: target.toolName,
          }),
        },
        "Failed to revoke policy rule.",
      );
    } catch (err) {
      setRules((prev) => [...prev, target]);
      setRulesError(err instanceof Error ? err.message : "Failed to revoke.");
    } finally {
      setRevoking(false);
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

      <hr className="my-6 border-zinc-200 dark:border-zinc-800" />

      <SettingsSection
        title="Policy Records"
        description="Permanent allow rules that grant tool access without approval. Revoke a rule to remove it."
      >
        {rulesLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rulesError ? (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{rulesError}</span>
            <SettingsSecondaryButton onClick={() => void fetchRules()}>
              Retry
            </SettingsSecondaryButton>
          </div>
        ) : rules.length === 0 ? (
          <SettingsEmptyState
            icon={ShieldCheck}
            title="No permanent allow rules"
            description="Allow always and allow family rules granted during tool execution will appear here."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">MCP</th>
                  <th className="px-4 py-3">Tool</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Granted At</th>
                  <th className="px-4 py-3">Granted By</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rules.map((rule) => (
                  <tr
                    key={`${rule.agentId}-${rule.mcpId}-${rule.toolName}`}
                    className="group hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  >
                    <td className="max-w-[140px] truncate px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                      {rule.agentId}
                    </td>
                    <td className="max-w-[120px] truncate px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {rule.mcpId}
                    </td>
                    <td className="max-w-[120px] truncate px-4 py-3 text-zinc-700 dark:text-zinc-300">
                      {rule.toolName}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {rule.reason ?? "\u2014"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {rule.updatedAt
                        ? new Date(rule.updatedAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "\u2014"}
                    </td>
                    <td className="max-w-[120px] truncate px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {rule.updatedBy ?? "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(rule)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                        title="Revoke this allow rule"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      <ConfirmDialog
        isOpen={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title="Revoke Allow Rule"
        message={
          revokeTarget
            ? "Are you sure you want to revoke the allow rule for " +
              revokeTarget.toolName +
              " on " +
              revokeTarget.mcpId +
              " (agent: " +
              revokeTarget.agentId +
              ")? This will require approval for future uses."
            : ""
        }
        confirmLabel={revoking ? "Revoking\u2026" : "Revoke"}
        variant="primary"
        busy={revoking}
        onConfirm={() => void handleRevoke()}
      />
    </>
  );
}
