"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { TextInput } from "@/components/ui/form-fields";
import { Select } from "@/components/ui/select";
import { PROVIDER_OPTIONS, providerLabelFromToken } from "@/features/onboarding/provider-catalog";

interface ProviderStatus {
  name: string;
  hasKey: boolean;
}

interface ProviderRow {
  id: string;
  name: string;
  apiKey: string;
}

let nextProviderId = 1;
function freshId() {
  return `provider-${nextProviderId++}`;
}

export function ProvidersTab({
  orgId,
  providers,
  onProvidersChange,
}: {
  orgId: string;
  providers: ProviderStatus[];
  onProvidersChange: (providers: ProviderStatus[]) => void;
}) {
  const [rows, setRows] = useState<ProviderRow[]>(() =>
    providers
      .filter((p) => p.hasKey)
      .map((p) => ({ id: freshId(), name: p.name, apiKey: "••••••••" })),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveProvider = async (row: ProviderRow) => {
    if (!row.name || !row.apiKey.trim() || !orgId) return;
    setError(null);
    setSavingId(row.id);
    try {
      const response = await fetch("/api/settings/providers", {
        method: "POST",
        body: JSON.stringify({
          organizationId: orgId,
          providerKeys: { [row.name]: row.apiKey.trim() },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to save provider.");
      }
      const data = await response.json();
      onProvidersChange(data.providers);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, apiKey: "••••••••" } : r)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingId(null);
    }
  };

  const deleteProvider = async (name: string, rowId: string) => {
    if (!orgId) return;
    setError(null);
    try {
      const response = await fetch(
        `/api/settings/providers/${encodeURIComponent(name)}?organizationId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to delete provider.");
      }
      const data = await response.json();
      onProvidersChange(data.providers);
      setRows((prev) => prev.filter((r) => r.id !== rowId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    }
  };

  const testProvider = async (name: string, rowId: string) => {
    if (!orgId) return;
    setTestingId(rowId);
    setTestResult(null);
    try {
      const response = await fetch(
        `/api/settings/providers/${encodeURIComponent(name)}/test?organizationId=${encodeURIComponent(orgId)}`,
        { method: "POST" },
      );
      const result = await response.json();
      setTestResult({ id: rowId, ok: result.ok, message: result.message });
    } catch (err) {
      setTestResult({ id: rowId, ok: false, message: "Test failed." });
    } finally {
      setTestingId(null);
    }
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: freshId(), name: "", apiKey: "" },
    ]);
  };

  const usedProviderNames = new Set(rows.map((r) => r.name).filter(Boolean));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Configure provider API keys used by your team roles.
        </p>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" />
          Add provider
        </button>
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const testResultForRow = testResult?.id === row.id ? testResult : null;
          return (
            <div key={row.id} className="flex flex-nowrap items-center gap-3">
              <Select
                value={row.name}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)),
                  )
                }
                className="w-[200px] shrink-0"
                placeholder="Select provider"
                options={PROVIDER_OPTIONS.filter(
                  (opt) => !usedProviderNames.has(opt.token) || opt.token === row.name,
                ).map((opt) => ({ value: opt.token, label: opt.label }))}
              />
              <TextInput
                type="password"
                value={row.apiKey}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r) => (r.id === row.id ? { ...r, apiKey: e.target.value } : r)),
                  )
                }
                className="min-w-0 flex-1"
                placeholder={row.name ? `${providerLabelFromToken(row.name)} API key` : "Provider API key"}
              />
              {row.apiKey && row.apiKey !== "••••••••" ? (
                <button
                  type="button"
                  disabled={savingId === row.id}
                  onClick={() => saveProvider(row)}
                  className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
                >
                  {savingId === row.id ? "Saving..." : "Save"}
                </button>
              ) : null}
              {row.apiKey === "••••••••" ? (
                <button
                  type="button"
                  disabled={testingId === row.id}
                  onClick={() => testProvider(row.name, row.id)}
                  className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  {testingId === row.id ? "Testing..." : "Test"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => deleteProvider(row.name, row.id)}
                className="rounded-lg border border-red-200 px-3 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {testResult ? (
        <p
          className={`text-sm ${
            testResult.ok
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {testResult.ok ? "Connected" : testResult.message}
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
