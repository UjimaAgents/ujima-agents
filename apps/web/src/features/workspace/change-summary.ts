import type { TraceStepData } from "./components/chat/details-sidebar";

export interface FileChange {
  id: string;
  file: string;
  additions: number;
  deletions: number;
  body: string;
  stepTitle: string;
}

export interface ChangeSummary {
  files: number;
  additions: number;
  deletions: number;
}

export function diffStats(body?: string): { additions: number; deletions: number } {
  if (!body) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) additions++;
    else if (trimmed.startsWith("-") && !trimmed.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

export function collectFileChanges(steps: TraceStepData[]): FileChange[] {
  const seen = new Set<string>();
  const changes: FileChange[] = [];
  const fileCounts = new Map<string, number>();

  const pushChange = (change: Omit<FileChange, "id">) => {
    const index = fileCounts.get(change.file) ?? 0;
    fileCounts.set(change.file, index + 1);
    changes.push({ ...change, id: `${change.file}:${change.stepTitle}:${index}` });
  };

  for (const step of steps) {
    for (const op of step.aggregatedOperations ?? []) {
      if ((op.type !== "edit" && op.type !== "delete") || !op.body || !op.file) continue;
      const key = `${op.file}:${op.body.slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const stats = op.additions || op.deletions ? op : diffStats(op.body);
      pushChange({
        file: op.file,
        additions: stats.additions,
        deletions: stats.deletions,
        body: op.body,
        stepTitle: step.title,
      });
    }

    if (step.filesystem?.action === "write" && step.filesystem.body) {
      const key = `${step.filesystem.resourcePath}:${step.filesystem.body.slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const stats = diffStats(step.filesystem.body);
      pushChange({
        file: step.filesystem.resourcePath,
        additions: stats.additions,
        deletions: stats.deletions,
        body: step.filesystem.body,
        stepTitle: step.title,
      });
    }
  }

  changes.sort((a, b) => a.file.localeCompare(b.file));
  return changes;
}

export function summarizeFileChanges(steps: TraceStepData[]): ChangeSummary {
  const changes = collectFileChanges(steps);
  return {
    files: new Set(changes.map((change) => change.file)).size,
    additions: changes.reduce((total, change) => total + change.additions, 0),
    deletions: changes.reduce((total, change) => total + change.deletions, 0),
  };
}
