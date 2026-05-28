"use client";

import { useState } from "react";
import type { RiskDefaults, ToolPolicyState } from "@ujima/shared";
import { Select } from "@/components/ui/select";

const STATE_OPTIONS: { value: ToolPolicyState; label: string }[] = [
  { value: "inherit", label: "Inherit (legacy default)" },
  { value: "allow", label: "Allow" },
  { value: "require_approval", label: "Require approval" },
  { value: "require_input", label: "Require confirmation" },
  { value: "deny", label: "Deny" },
];

const CLASS_DESCRIPTIONS: Record<keyof RiskDefaults, string> = {
  read: "Observes state. Idempotent. No side effects.",
  write: "Recoverable, scoped mutation.",
  destructive:
    "Irreversible action, scope-escaping side effect, or arbitrary code execution.",
  unknown: "Tools the classifier hasn't seen yet.",
};

interface Props {
  value: RiskDefaults;
  onSave: (next: Partial<RiskDefaults>) => Promise<void>;
}

export function GovernanceDefaultsPanel({ value, onSave }: Props) {
  const [draft, setDraft] = useState<RiskDefaults>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty =
    draft.read !== value.read ||
    draft.write !== value.write ||
    draft.destructive !== value.destructive ||
    draft.unknown !== value.unknown;

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const patch: Partial<RiskDefaults> = {};
      (Object.keys(draft) as (keyof RiskDefaults)[]).forEach((k) => {
        if (draft[k] !== value[k]) patch[k] = draft[k];
      });
      await onSave(patch);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Org-wide tool defaults
        </h4>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          What happens when a tool of each risk class is called and no explicit
          rule matches. Inherit preserves the previous behaviour.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(CLASS_DESCRIPTIONS) as (keyof RiskDefaults)[]).map((cls) => (
          <div key={cls} className="space-y-1">
            <label className="text-xs font-medium capitalize text-zinc-700 dark:text-zinc-200">
              {cls}
            </label>
            <Select
              value={draft[cls]}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  [cls]: e.target.value as ToolPolicyState,
                }))
              }
              options={STATE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {CLASS_DESCRIPTIONS[cls]}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {error
            ? <span className="text-rose-600 dark:text-rose-400">{error}</span>
            : savedAt
              ? "Saved."
              : ""}
        </span>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
          className={`rounded-md px-3 py-1 text-xs font-medium transition ${
            !dirty || saving
              ? "cursor-not-allowed bg-zinc-200 text-zinc-500 dark:bg-zinc-800"
              : "bg-violet-600 text-white hover:bg-violet-700"
          }`}
        >
          {saving ? "Saving…" : "Save defaults"}
        </button>
      </div>
    </div>
  );
}
