"use client";

import { useCallback, useState } from "react";
import { clientFetchJson } from "@/lib/client-api";
import { usePolling } from "@/hooks/use-polling";
import type { ActiveJob } from "../workspace-store";
import type { RunState } from "@ujima/shared/browser";

export function useActiveTerminalJobs(
  globalActiveRuns: RunState[],
  organizationId?: string,
): ActiveJob[] {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const refresh = useCallback(async () => {
    if (!organizationId || globalActiveRuns.length === 0) {
      setJobs([]);
      return;
    }
    const lists = await Promise.all(
      globalActiveRuns.map(async (run) => {
        const data = await clientFetchJson<unknown[]>(
          `/api/runs/${encodeURIComponent(run.id)}/jobs?organizationId=${encodeURIComponent(organizationId)}`,
          {},
          "Unable to load terminal jobs.",
        ).catch(() => []);
        return data.flatMap((job): ActiveJob[] => {
          if (!job || typeof job !== "object") return [];
          const record = job as Record<string, unknown>;
          if (typeof record.id !== "string") return [];
          return [
            {
              runId: run.id,
              jobId: record.id,
              commandLine: typeof record.commandLine === "string" ? record.commandLine : "",
              cwd: typeof record.cwd === "string" ? record.cwd : "",
              status: typeof record.status === "string" ? record.status : "running",
            },
          ];
        });
      }),
    );
    setJobs(lists.flat().filter((job) => job.status === "running"));
  }, [globalActiveRuns, organizationId]);

  usePolling(refresh, {
    intervalMs: 3000,
    enabled: Boolean(organizationId && globalActiveRuns.length > 0),
  });

  return organizationId && globalActiveRuns.length > 0 ? jobs : [];
}
