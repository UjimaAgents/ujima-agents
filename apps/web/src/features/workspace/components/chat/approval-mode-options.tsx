import { Check, CircleAlert, Hand, Shield, ShieldCheck, type LucideIcon } from "lucide-react";
import type { MemberShellApprovalMode, ShellApprovalMode } from "@ujima/shared/browser";

export interface ApprovalModeOption<TValue extends string> {
  value: TValue;
  label: string;
  description: string;
  Icon: LucideIcon;
}

const INHERIT_OPTION = {
  value: "inherit",
  label: "Use org default",
  description: "Follow the organization approval policy",
  Icon: Shield,
} satisfies ApprovalModeOption<MemberShellApprovalMode>;
const ALWAYS_REVIEW_OPTION = {
  value: "always_review",
  label: "Ask for approval",
  description: "Always ask to edit external files and use the internet",
  Icon: Hand,
} satisfies ApprovalModeOption<MemberShellApprovalMode>;
const AUTO_REVIEW_OPTION = {
  value: "auto_review",
  label: "Approve for me",
  description: "Only ask for actions detected as potentially unsafe",
  Icon: ShieldCheck,
} satisfies ApprovalModeOption<MemberShellApprovalMode>;
const ALLOW_ALL_OPTION = {
  value: "allow_all",
  label: "Full access",
  description: "Unrestricted access to the internet and any file on your computer",
  Icon: CircleAlert,
} satisfies ApprovalModeOption<MemberShellApprovalMode>;

export const MEMBER_APPROVAL_OPTIONS = [
  INHERIT_OPTION,
  ALWAYS_REVIEW_OPTION,
  AUTO_REVIEW_OPTION,
  ALLOW_ALL_OPTION,
] as const;

export const CHANNEL_APPROVAL_OPTIONS = [
  ALWAYS_REVIEW_OPTION,
  AUTO_REVIEW_OPTION,
  ALLOW_ALL_OPTION,
] satisfies readonly ApprovalModeOption<ShellApprovalMode>[];

export function ApprovalModeOptionRow<TValue extends string>({
  option,
  selected,
  disabled,
  onSelect,
}: {
  option: ApprovalModeOption<TValue>;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const Icon = option.Icon;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "bg-orange-500/10 text-orange-600 dark:text-orange-300"
          : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
      }`}
    >
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          selected ? "text-orange-500 dark:text-orange-300" : "text-zinc-400 dark:text-zinc-500"
        }`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-5">{option.label}</span>
        <span className="mt-0.5 block text-xs font-normal leading-4 text-zinc-500 dark:text-zinc-400">
          {option.description}
        </span>
      </span>
      {selected ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500 dark:text-orange-300" /> : null}
    </button>
  );
}
