interface CanvasPanelProps {
  organizationName: string;
  ownerName: string;
  teamRoleCount: number;
}

export function CanvasPanel({ organizationName, ownerName, teamRoleCount }: CanvasPanelProps) {
  return (
    <section className="h-full rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Canvas</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">react-resizable-panels</span>
      </div>
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-950">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{organizationName || "Your Organization"}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Owner: {ownerName || "Unassigned"}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Roles configured: {teamRoleCount}</p>
          <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
            This visualization slot can render org-chart, role topology, or agent-channel map.
          </p>
        </div>
      </div>
    </section>
  );
}
