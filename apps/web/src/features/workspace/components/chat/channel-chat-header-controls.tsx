"use client";

import { useState } from "react";
import { Check, ChevronDown, Shield } from "lucide-react";
import type { ShellApprovalMode } from "@ujima/shared/browser";

const APPROVAL_OPTIONS: { value: ShellApprovalMode; label: string }[] = [
  { value: "always_review", label: "Ask for approval" },
  { value: "auto_review", label: "Approve for me" },
  { value: "allow_all", label: "Full access" },
];

export function ChannelChatHeaderControls({
  value,
  onChange,
}: {
  value: ShellApprovalMode;
  onChange: (value: ShellApprovalMode) => Promise<void> | void;
}) {
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex w-full flex-col text-left">
      <button
        type="button"
        disabled={saving}
        onClick={() => setOpen((current) => !current)}
        className="grid w-full grid-cols-[1.25rem_minmax(7rem,1fr)_minmax(0,10rem)_1rem] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[15px] font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-100 dark:hover:bg-zinc-800"
        aria-expanded={open}
      >
        <Shield className="h-5 w-5 text-zinc-500 dark:text-zinc-300" />
        <span className="min-w-0 truncate">Shell approvals</span>
        <span className="min-w-0 truncate text-right text-sm text-zinc-400">
          {APPROVAL_OPTIONS.find((option) => option.value === value)?.label}
        </span>
        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="mt-1 flex flex-col pl-10">
          {APPROVAL_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                Promise.resolve(onChange(option.value))
                  .catch((err) => {
                    console.error(err);
                  })
                  .finally(() => {
                    setSaving(false);
                  });
              }}
              className="flex items-center rounded-lg px-2.5 py-2 text-left text-[16px] font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              {option.label}
              {option.value === value ? <Check className="ml-auto h-4 w-4 text-zinc-900 dark:text-white" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
