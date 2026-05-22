"use client";

import { Select } from "@/components/ui/select";

type OrgChartRowOption = { value: string; label: string };

export function OrgChartFields({
  description = "Set who each agent reports to.",
  rows,
  onManagerChange,
}: {
  description?: string;
  rows: Array<{
    key: string;
    subjectLabel: string;
    managerValue: string;
    managerOptions: OrgChartRowOption[];
  }>;
  onManagerChange: (key: string, managerValue: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      <div className="space-y-3">
        {rows.map((row) => (
          <OrgChartRow
            key={row.key}
            subjectLabel={row.subjectLabel}
            managerValue={row.managerValue}
            managerOptions={row.managerOptions}
            onManagerChange={(value) => onManagerChange(row.key, value)}
          />
        ))}
      </div>
    </div>
  );
}

function OrgChartRow({
  subjectLabel,
  managerValue,
  managerOptions,
  onManagerChange,
}: {
  subjectLabel: string;
  managerValue: string;
  managerOptions: OrgChartRowOption[];
  onManagerChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-nowrap items-center gap-3">
      <div className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
        {subjectLabel}
      </div>
      <div className="flex w-10 shrink-0 items-center justify-center text-sm text-zinc-400">→</div>
      <Select
        value={managerValue}
        onChange={(e) => onManagerChange(e.target.value)}
        className="min-w-0 flex-1"
        options={managerOptions}
      />
    </div>
  );
}
