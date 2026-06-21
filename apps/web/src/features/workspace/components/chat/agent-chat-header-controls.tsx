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

const PROVIDER_LABELS: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", google: "Google" };

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

  const modelOptions = useMemo(
    () =>
      listConfiguredProviderModels(
        providers,
        (provider, model) => `${PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)} · ${model}`,
      ),
    [providers],
  );

  const selectedModelValue = resolveMemberModelSelection(member);
  const selectedModelOptions = useMemo(() => {
    if (!selectedModelValue || modelOptions.some((option) => option.value === selectedModelValue)) {
      return modelOptions;
    }
    const parsed = parseConfiguredProviderModelValue(selectedModelValue);
    const providerLabel = parsed ? (PROVIDER_LABELS[parsed.provider] ?? parsed.provider.charAt(0).toUpperCase() + parsed.provider.slice(1)) : selectedModelValue;
    return [
      {
        value: selectedModelValue,
        label: parsed ? `${providerLabel} · ${parsed.model}` : selectedModelValue,
      },
      ...modelOptions,
    ];
  }, [modelOptions, selectedModelValue]);

  const patchPreferences = async (body: {
    shellApprovalMode?: MemberShellApprovalMode;
    llm?: string;
    model?: string;
  }) => {
    setSaving(true);
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
      console.error(err);
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
            options={selectedModelOptions}
            placeholder="Select model"
            className="w-[8.8rem] sm:w-40"
          />
        ) : null}
      </div>
    </div>
  );
}
