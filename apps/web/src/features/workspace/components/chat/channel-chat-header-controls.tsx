"use client";

import { useState } from "react";
import { ChevronDown, Shield } from "lucide-react";
import type { ShellApprovalMode } from "@ujima/shared/browser";
import { ApprovalModeOptionRow, CHANNEL_APPROVAL_OPTIONS } from "./approval-mode-options";

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
        className="grid w-full grid-cols-[1rem_minmax(7rem,1fr)_minmax(0,10rem)_0.875rem] items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-100 dark:hover:bg-zinc-800"
        aria-expanded={open}
      >
        <Shield className="h-4 w-4 text-zinc-500 dark:text-zinc-300" />
        <span className="min-w-0 truncate">Approvals</span>
        <span className="min-w-0 truncate text-right text-xs text-zinc-400">
          {CHANNEL_APPROVAL_OPTIONS.find((option) => option.value === value)?.label}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="mt-0.5 flex flex-col pl-8">
          {CHANNEL_APPROVAL_OPTIONS.map((option) => (
            <ApprovalModeOptionRow
              key={option.value}
              option={option}
              selected={option.value === value}
              disabled={saving}
              onSelect={() => {
                setSaving(true);
                Promise.resolve(onChange(option.value))
                  .catch((err) => {
                    console.error(err);
                  })
                  .finally(() => {
                    setSaving(false);
                  });
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
