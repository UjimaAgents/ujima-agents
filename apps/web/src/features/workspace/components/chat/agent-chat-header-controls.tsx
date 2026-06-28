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
    <div className="flex flex-col gap-3.5 text-left">
      {/* Model Option */}
      {modelOptions.length > 0 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="agent-model" className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Model Selection
          </label>
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
            className="w-full"
          />
        </div>
      ) : null}

      {/* Shell Approval Option */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          Shell Execution Approvals
        </span>
        {goalMode ? (
          <div className="flex pt-0.5">
            <span className="inline-flex items-center rounded-full border border-amber-200/60 bg-amber-50/50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
              Goal mode · Auto review
            </span>
          </div>
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
      </div>
    </div>
  );
}
