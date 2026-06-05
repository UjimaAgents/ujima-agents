"use client";

import { Check, ChevronDown, Shield, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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

function orgShellModeLabel(mode: ShellApprovalMode): string {
  return ORG_APPROVAL_OPTIONS.find((o) => o.value === mode)?.label ?? "Shell approval";
}

const ORG_APPROVAL_OPTIONS: Array<{
  value: ShellApprovalMode;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "always_review",
    label: "Ask for approval",
    description: "Always ask to edit external files and use the internet.",
    icon: ShieldAlert,
  },
  {
    value: "auto_review",
    label: "Approve for me",
    description: "Only ask for actions detected as potentially unsafe.",
    icon: ShieldCheck,
  },
  {
    value: "allow_all",
    label: "Full access",
    description: "Unrestricted access to the internet and any file on your computer.",
    icon: Shield,
  },
];

export function ShellApprovalOrgModeSelect({
  value,
  onChange,
  disabled = false,
  ariaLabel = "Shell approval",
  className = "w-full min-w-[11rem] sm:w-52",
  menuPlacement = "down",
  size = "default",
}: {
  value: ShellApprovalMode;
  onChange: (value: ShellApprovalMode) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  menuPlacement?: "down" | "up";
  size?: "default" | "sm";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedOption = ORG_APPROVAL_OPTIONS.find((option) => option.value === value);
  const triggerSizeClass =
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2.5 text-sm";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(448, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      setMenuStyle({
        position: "fixed",
        left,
        top: menuPlacement === "up" ? rect.top : rect.bottom,
        transform: menuPlacement === "up" ? "translateY(calc(-100% - 8px))" : "translateY(8px)",
        width,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen, menuPlacement]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white text-zinc-900 outline-none transition focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 ${triggerSizeClass}`}
      >
        <span className="min-w-0 truncate">{selectedOption?.label ?? "Shell approval"}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && mounted
        ? createPortal(
            <div
              ref={menuRef}
              className="z-50 max-h-[min(28rem,calc(100vh-1.5rem))] overflow-auto rounded-xl border border-violet-500/[0.08] bg-zinc-950/95 p-2 text-zinc-100 shadow-2xl shadow-black/30 backdrop-blur-md dark:border-white/[0.08]"
              style={menuStyle}
            >
              {ORG_APPROVAL_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition ${
                      selected
                        ? "bg-white/6 text-zinc-50"
                        : "text-zinc-200 hover:bg-white/[0.04] hover:text-zinc-50"
                    }`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-zinc-100 transition">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium">{option.label}</span>
                        {selected ? <Check className="h-4 w-4 text-zinc-100" /> : null}
                      </span>
                      <span className="mt-0.5 block text-sm leading-5 text-zinc-400">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

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
  const select = <ShellApprovalOrgModeSelect value={value} onChange={onChange} />;

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
