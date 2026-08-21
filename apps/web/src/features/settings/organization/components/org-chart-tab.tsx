"use client";

import { useMemo, useState, useCallback, memo } from "react";
import type { OrganizationSettingsResponse } from "@ujima/api-schema";
import { OrgChartFields } from "@/features/team/org-chart-fields";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";
import { clientFetchJson } from "@/lib/client-api";

type Member = NonNullable<OrganizationSettingsResponse["members"]>[number];

export const OrgChartTab = memo(function OrgChartTab({
  orgId,
  members,
  organizationChart,
}: {
  orgId: string;
  members: Member[];
  organizationChart: { reportsTo: Record<string, string> };
}) {
  const agentMembers = useMemo(
    () => members.filter((m) => m.kind === "agent" && !m.retiredAt),
    [members],
  );
  const humanMembers = useMemo(
    () => members.filter((m) => m.kind === "human" && !m.retiredAt),
    [members],
  );
  const owner = useMemo(
    () => humanMembers.find((m) => m.roleName === "owner"),
    [humanMembers],
  );

  const [reportsTo, setReportsTo] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const agent of agentMembers) {
      map[agent.id] = organizationChart.reportsTo[agent.id] ?? owner?.id ?? "";
    }
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const baseManagerOptions = useMemo(
    () => [
      ...humanMembers.map((m) => ({ value: m.id, label: m.name })),
      ...agentMembers.map((m) => ({ value: m.id, label: `${m.name} (agent)` })),
    ],
    [agentMembers, humanMembers],
  );

  const rows = useMemo(
    () =>
      agentMembers.map((agent) => ({
        key: agent.id,
        subjectLabel: agent.name,
        managerValue: reportsTo[agent.id] ?? "",
        managerOptions: baseManagerOptions.filter((opt) => opt.value !== agent.id),
      })),
    [agentMembers, baseManagerOptions, reportsTo],
  );

  const handleSave = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      await clientFetchJson<unknown>("/api/settings/organization", {
        method: "PATCH",
        body: JSON.stringify({
          organizationId: orgId,
          organizationChart: { reportsTo },
        }),
      }, "Failed to update org chart.");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }, [orgId, reportsTo]);

  const handleManagerChange = useCallback((key: string, managerValue: string) => {
    setReportsTo((prev) => ({ ...prev, [key]: managerValue }));
  }, []);

  return (
    <>
      <OrgChartFields
        description="Order the reporting structure from agent on the left to their manager on the right."
        rows={rows}
        onManagerChange={handleManagerChange}
      />

      <div className="mt-4 flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <SettingsPrimaryButton disabled={saving} onClick={() => void handleSave()}>
          {saving ? "Saving…" : "Save"}
        </SettingsPrimaryButton>
        {success ? (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved</span>
        ) : null}
        {error ? (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">{error}</span>
        ) : null}
      </div>
    </>
  );
});
