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
    <div className="flex min-w-0 flex-col items-end gap-1.5">
      <ShellApprovalOrgModeSelect
        value={value}
        size="sm"
        disabled={saving}
        className="w-[10.5rem] sm:w-52"
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
