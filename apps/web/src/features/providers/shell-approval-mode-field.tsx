"use client";

import type { MemberShellApprovalMode, ShellApprovalMode } from "@ujima/shared/browser";
import { Select, type SelectOption } from "@/components/ui/select";
import { FieldShell } from "@/components/ui/form-fields";

const SHELL_APPROVAL_HINT =
  "Auto review uses each agent's model to approve safe shell commands; risky commands still need your approval.";

export const MEMBER_SHELL_MODE_OPTIONS: { value: MemberShellApprovalMode; label: string }[] = [
  { value: "inherit", label: "Org default" },
  { value: "always_review", label: "Always review" },
  { value: "auto_review", label: "Auto review" },
  { value: "allow_all", label: "Allow all" },
];

const ORG_SHELL_MODES = ["always_review", "auto_review", "allow_all"] as const;

export function orgShellModeLabel(mode: ShellApprovalMode): string {
  switch (mode) {
    case "always_review":
      return "Always review";
    case "auto_review":
      return "Auto review";
    case "allow_all":
      return "Allow all";
  }
}

const ORG_SHELL_SELECT_OPTIONS: SelectOption[] = ORG_SHELL_MODES.map((mode) => ({
  value: mode,
  label: orgShellModeLabel(mode),
}));

export function memberShellModeSelectOptions(orgMode: ShellApprovalMode): SelectOption[] {
  return MEMBER_SHELL_MODE_OPTIONS.map((option) =>
    option.value === "inherit"
      ? { value: option.value, label: `Org default (${orgShellModeLabel(orgMode)})` }
      : { value: option.value, label: option.label },
  );
}

export function ShellApprovalOrgModeField({
  value,
  onChange,
  variant = "toggle",
}: {
  value: ShellApprovalMode;
  onChange: (value: ShellApprovalMode) => void;
  variant?: "checkbox" | "toggle";
}) {
  const select = (
    <Select
      id="org-shell-approval-mode"
      value={value}
      onChange={(event) => onChange(event.target.value as ShellApprovalMode)}
      options={ORG_SHELL_SELECT_OPTIONS}
      placeholder="Select shell approval"
      className="w-full min-w-[11rem] sm:w-52"
    />
  );

  if (variant === "toggle") {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Approval for shell
          </span>
          <span className="mt-0.5 block text-sm text-zinc-500 dark:text-zinc-400">
            {SHELL_APPROVAL_HINT}
          </span>
        </span>
        <div className="w-full shrink-0 sm:w-52">{select}</div>
      </div>
    );
  }

  return (
    <FieldShell label="Approval for shell" htmlFor="org-shell-approval-mode" hint={SHELL_APPROVAL_HINT}>
      {select}
    </FieldShell>
  );
}

export function ShellApprovalMemberModeField({
  value,
  orgMode,
  onChange,
  disabled = false,
}: {
  value: MemberShellApprovalMode;
  orgMode: ShellApprovalMode;
  onChange: (value: MemberShellApprovalMode) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      id="member-shell-approval-mode"
      size="sm"
      value={value}
      disabled={disabled}
      ariaLabel="Shell approval"
      onChange={(event) => onChange(event.target.value as MemberShellApprovalMode)}
      options={memberShellModeSelectOptions(orgMode)}
      placeholder="Shell approval"
      className="w-[10.5rem] sm:w-48"
    />
  );
}
