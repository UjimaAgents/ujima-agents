"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import type { OrganizationSettingsResponse } from "@ujima/api-schema";

type Member = NonNullable<OrganizationSettingsResponse["members"]>[number];

export function OrgChartTab({
  orgId,
  members,
  organizationChart,
}: {
  orgId: string;
  members: Member[];
  organizationChart: { reportsTo: Record<string, string> };
}) {
  const agentMembers = members.filter((m) => m.kind === "agent");
  const humanMembers = members.filter((m) => m.kind === "human");
  const owner = humanMembers.find((m) => m.roleName === "owner");

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

  const managerOptions = [
    ...humanMembers.map((m) => ({ value: m.id, label: `${m.name} (${m.roleName})` })),
    ...agentMembers.map((m) => ({ value: m.id, label: `${m.name} (agent)` })),
  ];

  const handleSave = async () => {
    if (!orgId) return;
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      const response = await fetch("/api/settings/organization", {
        method: "PATCH",
        body: JSON.stringify({
          organizationId: orgId,
          organizationChart: { reportsTo },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to update org chart.");
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
        Each agent reports to a manager or the owner.
      </p>

      <div className="space-y-3">
        {agentMembers.map((agent) => (
          <div key={agent.id} className="flex flex-nowrap items-center gap-3">
            <div className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
              {agent.name}
            </div>
            <div className="flex w-10 shrink-0 items-center justify-center text-sm text-zinc-400">→</div>
            <Select
              value={reportsTo[agent.id] ?? ""}
              onChange={(e) =>
                setReportsTo((prev) => ({ ...prev, [agent.id]: e.target.value }))
              }
              className="min-w-0 flex-1"
              options={managerOptions.filter((opt) => opt.value !== agent.id)}
              placeholder="Select manager"
            />
          </div>
        ))}
      </div>

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
  );
}
