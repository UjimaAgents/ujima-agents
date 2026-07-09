import type { TraceStepData } from "./components/chat/trace-types";
import { diffStats } from "@ujima/shared/browser";

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
      if (seen.has(op.id)) continue;
      seen.add(op.id);
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
      if (seen.has(step.id)) continue;
      seen.add(step.id);
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
