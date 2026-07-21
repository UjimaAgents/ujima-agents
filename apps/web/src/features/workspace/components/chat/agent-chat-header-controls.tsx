"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Cpu, Shield } from "lucide-react";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { Member } from "@ujima/shared";
import {
  type MemberShellApprovalMode,
  type ShellApprovalMode,
  getModelOptionsForProvider,
  listConfiguredProviderModels,
  parseConfiguredProviderModelValue,
  resolveMemberModelSelection,
} from "@ujima/shared/browser";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  "anthropic-claude-code": "Claude Code",
  anthropic: "Anthropic",
  google: "Google",
};
const APPROVAL_OPTIONS: { value: MemberShellApprovalMode; label: string }[] = [
  { value: "inherit", label: "Use org default" },
  { value: "always_review", label: "Ask for approval" },
  { value: "auto_review", label: "Approve for me" },
  { value: "allow_all", label: "Full access" },
];

export function AgentChatHeaderControls({
  orgId,
  member,
  providers,
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
  const [modelOpen, setModelOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);

  const modelOptions = useMemo(
    () => {
      const configured = listConfiguredProviderModels(
        providers,
        (provider, model) => `${PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)} · ${model}`,
      );
      const selectedProvider =
        parseConfiguredProviderModelValue(resolveMemberModelSelection(member))?.provider ??
        member.llm ??
        "";
      if (!selectedProvider || configured.some((option) => option.provider === selectedProvider)) {
        return configured;
      }
      const providerLabel =
        PROVIDER_LABELS[selectedProvider] ??
        selectedProvider.charAt(0).toUpperCase() + selectedProvider.slice(1);
      return [
        ...configured,
        ...getModelOptionsForProvider(selectedProvider).map((option) => ({
          provider: selectedProvider,
          model: option.value,
          label: option.label,
          selectedLabel: `${providerLabel} · ${option.label}`,
          value: `${selectedProvider}::${option.value}`,
        })),
      ];
    },
    [member, providers],
  );

  const rawSelectedModelValue = resolveMemberModelSelection(member);
  const selectedModelValue = useMemo(() => {
    const parsed = parseConfiguredProviderModelValue(rawSelectedModelValue);
    if (
      parsed?.provider === "openai" &&
      !providers.some((provider) => provider.name === "openai" && provider.hasKey) &&
      providers.some((provider) => provider.name === "openai-codex" && provider.hasKey)
    ) {
      const codexValue = `openai-codex::${parsed.model}`;
      if (modelOptions.some((option) => option.value === codexValue)) return codexValue;
    }
    if (
      parsed?.provider === "anthropic" &&
      !providers.some((provider) => provider.name === "anthropic" && provider.hasKey) &&
      providers.some((provider) => provider.name === "anthropic-claude-code" && provider.hasKey)
    ) {
      const claudeCodeValue = `anthropic-claude-code::${parsed.model}`;
      if (modelOptions.some((option) => option.value === claudeCodeValue)) return claudeCodeValue;
    }
    return rawSelectedModelValue;
  }, [modelOptions, providers, rawSelectedModelValue]);
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
        selectedLabel: parsed ? `${providerLabel} · ${parsed.model}` : selectedModelValue,
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
    <div className="flex flex-col gap-3 text-left">
      {modelOptions.length > 0 ? (
        <div className="flex flex-col">
          <button
            type="button"
            disabled={saving}
            onClick={() => setModelOpen((open) => !open)}
            className="grid w-full grid-cols-[1.25rem_minmax(4.5rem,1fr)_minmax(0,12rem)_1rem] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[15px] font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-100 dark:hover:bg-zinc-800"
            aria-expanded={modelOpen}
          >
            <Cpu className="h-5 w-5 text-zinc-500 dark:text-zinc-300" />
            <span className="min-w-0 truncate">Model</span>
            <span className="min-w-0 truncate text-right text-sm text-zinc-400">
              {selectedModelOptions.find((option) => option.value === selectedModelValue)?.selectedLabel ?? "Select model"}
            </span>
            <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${modelOpen ? "rotate-180" : ""}`} />
          </button>
          {modelOpen ? (
            <div className="mt-1 flex max-h-64 flex-col overflow-y-auto pl-10">
              {selectedModelOptions.map((option) => {
                const parsed = parseConfiguredProviderModelValue(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={saving || !parsed}
                    onClick={() => {
                      if (!parsed) return;
                      void patchPreferences({ llm: parsed.provider, model: parsed.model });
                    }}
                    className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[16px] font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                  >
                    <span className="min-w-0 flex-1 truncate">{option.selectedLabel}</span>
                    {option.value === selectedModelValue ? <Check className="ml-auto h-4 w-4 text-zinc-900 dark:text-white" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col">
        {goalMode ? (
          <div className="grid grid-cols-[1.25rem_minmax(4.5rem,1fr)_minmax(0,12rem)] items-center gap-3 rounded-lg px-2.5 py-2 text-[15px] font-medium text-zinc-900 dark:text-zinc-100">
            <Shield className="h-5 w-5 text-zinc-500 dark:text-zinc-300" />
            <span className="min-w-0 truncate">Shell approvals</span>
            <span className="min-w-0 truncate text-right text-sm text-amber-300">
              Goal mode · Auto review
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => setApprovalOpen((open) => !open)}
              className="grid w-full grid-cols-[1.25rem_minmax(7rem,1fr)_minmax(0,10rem)_1rem] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[15px] font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-100 dark:hover:bg-zinc-800"
              aria-expanded={approvalOpen}
            >
              <Shield className="h-5 w-5 text-zinc-500 dark:text-zinc-300" />
              <span className="min-w-0 truncate">Shell approvals</span>
              <span className="min-w-0 truncate text-right text-sm text-zinc-400">
                {APPROVAL_OPTIONS.find((option) => option.value === (member.shellApprovalMode ?? "inherit"))?.label}
              </span>
              <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${approvalOpen ? "rotate-180" : ""}`} />
            </button>
            {approvalOpen ? (
              <div className="mt-1 flex flex-col pl-10">
                {APPROVAL_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={saving}
                    onClick={() => void patchPreferences({ shellApprovalMode: option.value })}
                    className="flex items-center rounded-lg px-2.5 py-2 text-left text-[16px] font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                  >
                    {option.label}
                    {option.value === (member.shellApprovalMode ?? "inherit") ? <Check className="ml-auto h-4 w-4 text-zinc-900 dark:text-white" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
