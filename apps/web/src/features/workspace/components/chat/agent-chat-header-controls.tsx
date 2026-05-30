"use client";

import { useMemo, useState } from "react";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { Member } from "@ujima/shared";
import {
  type MemberShellApprovalMode,
  type ShellApprovalMode,
  listConfiguredProviderModels,
  parseConfiguredProviderModelValue,
  resolveMemberModelSelection,
} from "@ujima/shared/browser";
import { ShellApprovalMemberModeField } from "@/features/providers/shell-approval-mode-field";
import { Select } from "@/components/ui/select";

export function AgentChatHeaderControls({
  orgId,
  member,
  providers,
  orgShellApprovalMode,
  goalMode,
  onMemberUpdated,
}: {
  orgId: string;
  member: Member;
  providers: BootstrapResponse["providers"];
  orgShellApprovalMode: ShellApprovalMode;
  goalMode: boolean;
  onMemberUpdated: (member: Member) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modelOptions = useMemo(
    () =>
      listConfiguredProviderModels(
        providers,
        (provider, model) => `${formatProviderLabel(provider)} · ${model}`,
      ),
    [providers],
  );

  const selectedModelValue = resolveMemberModelSelection(member, providers);

  const patchPreferences = async (body: {
    shellApprovalMode?: MemberShellApprovalMode;
    llm?: string;
    model?: string;
  }) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(member.id)}/preferences`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.message ?? "Unable to update agent preferences.");
      }
      const updated = (await response.json()) as Member;
      onMemberUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col items-end gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {goalMode ? (
          <span className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            Goal mode · Auto review
          </span>
        ) : (
          <ShellApprovalMemberModeField
            value={member.shellApprovalMode ?? "inherit"}
            orgMode={orgShellApprovalMode}
            disabled={saving}
            onChange={(shellApprovalMode) => {
              void patchPreferences({ shellApprovalMode });
            }}
          />
        )}

        {modelOptions.length > 0 ? (
          <Select
            id="agent-model"
            size="sm"
            value={selectedModelValue}
            disabled={saving}
            ariaLabel="Agent model"
            onChange={(event) => {
              const parsed = parseConfiguredProviderModelValue(event.target.value);
              if (!parsed) return;
              void patchPreferences({ llm: parsed.provider, model: parsed.model });
            }}
            options={modelOptions.map((option) => ({
              value: option.value,
              label: option.label,
              selectedLabel: option.selectedLabel,
            }))}
            placeholder="Select model"
            className="w-[10.5rem] sm:w-52"
          />
        ) : null}
      </div>

      {error ? (
        <span className="text-[10px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function formatProviderLabel(provider: string): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "google") return "Google";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
