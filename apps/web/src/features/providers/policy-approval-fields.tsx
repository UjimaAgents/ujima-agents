"use client";

const FIELDS = [
  {
    key: "requireApprovalForWrites" as const,
    label: "Require approval for writes",
    description: "Agent write operations must be approved before execution.",
  },
  {
    key: "requireApprovalForShell" as const,
    label: "Require approval for shell",
    description: "Shell execution must be reviewed before commands run.",
  },
] as const;

type PolicyKey = (typeof FIELDS)[number]["key"];

export function PolicyApprovalFields({
  values,
  onChange,
  variant = "checkbox",
}: {
  values: Record<PolicyKey, boolean>;
  onChange: (key: PolicyKey, value: boolean) => void;
  variant?: "checkbox" | "toggle";
}) {
  return (
    <div className="space-y-3">
      {FIELDS.map((field) => {
        const checked = values[field.key];
        if (variant === "toggle") {
          return (
            <PolicyToggleRow
              key={field.key}
              label={field.label}
              description={field.description}
              checked={checked}
              onChange={(value) => onChange(field.key, value)}
            />
          );
        }
        return (
          <label
            key={field.key}
            className="flex items-center justify-between rounded-2xl border border-zinc-200 px-4 py-4 dark:border-zinc-800"
          >
            <span>
              <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {field.label}
              </span>
              <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
                {field.description}
              </span>
            </span>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => onChange(field.key, event.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600"
            />
          </label>
        );
      })}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Workspace boundary mode is <span className="font-medium text-zinc-700 dark:text-zinc-300">hard</span> — agents cannot read or write outside their workspace scopes.
      </p>
    </div>
  );
}

function PolicyToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
        <span className="mt-0.5 block text-sm text-zinc-500 dark:text-zinc-400">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`inline-flex h-6 w-11 shrink-0 cursor-pointer items-center overflow-hidden rounded-full p-0.5 transition-colors ${
          checked
            ? "bg-zinc-900 dark:bg-zinc-100"
            : "bg-zinc-300 dark:bg-zinc-600"
        }`}
      >
        <span
          aria-hidden
          className={`pointer-events-none block h-5 w-5 shrink-0 rounded-full transition-transform ${
            checked
              ? "translate-x-5 bg-white dark:bg-zinc-900"
              : "translate-x-0 bg-white"
          }`}
        />
      </button>
    </div>
  );
}
