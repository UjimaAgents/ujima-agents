"use client";

import { useState } from "react";
import type { ShellApprovalMode } from "@ujima/shared/browser";
import { ShellApprovalOrgModeSelect } from "@/features/providers/shell-approval-mode-field";

export function ChannelChatHeaderControls({
  value,
  onChange,
}: {
  value: ShellApprovalMode;
  onChange: (value: ShellApprovalMode) => Promise<void> | void;
}) {
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-col gap-1 text-left w-full">
      <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
        Workspace Shell Approvals
      </label>
      <ShellApprovalOrgModeSelect
        value={value}
        size="sm"
        disabled={saving}
        className="w-full"
        menuPlacement="down"
        onChange={(next) => {
          setSaving(true);
          Promise.resolve(onChange(next))
            .catch((err) => {
              console.error(err);
            })
            .finally(() => {
              setSaving(false);
            });
        }}
      />
    </div>
  );
}
