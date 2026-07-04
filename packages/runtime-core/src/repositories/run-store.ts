import type { RunState, RunStep } from '@ujima/shared';

export interface PaginatedRuns {
  data: RunState[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Narrow port for run + run-step operations.
 */
export interface RunStore {
  saveRun(run: RunState): RunState;
  getRun(organizationId: string, runId: string): RunState | null;
  listRuns(
    organizationId: string,
    cursor?: string,
    limit?: number,
  ): PaginatedRuns;
  findActiveRunForMemberThread(
    organizationId: string,
    memberId: string,
    threadId: string,
  ): RunState | null;
  saveRunStep(step: RunStep): RunStep;
  listRunSteps(organizationId: string, runId: string): RunStep[];
  listActiveRuns(organizationId: string): RunState[];
}
