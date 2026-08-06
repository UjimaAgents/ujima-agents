import { describe, expect, it } from 'vitest';
import type { RunStep } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import { visibleHistoryRunSteps } from './agent-run-context.js';

const step = (runId: string, toolCallId: string): RunStep => ({
  id: `step-${toolCallId}`,
  organizationId: 'org-1',
  runId,
  threadId: 'thread-1',
  agentId: 'agent-1',
  toolCallId,
  toolId: 'view',
  action: 'read',
  resourceType: 'file',
  resourcePath: 'README.md',
  input: { path: 'README.md' },
  output: { content: 'kept' },
  status: 'ok',
  createdAt: '2026-07-28T07:30:00.000Z',
});

describe('visibleHistoryRunSteps', () => {
  it('recovers latest prior run when it published no progress message', () => {
    const repo = {
      listThreadRuns: () => ({
        data: [{ id: 'current' }, { id: 'crashed' }],
        hasMore: false,
      }),
      listRunSteps: (_org: string, runId: string) => [step(runId, 'call-1')],
    } as unknown as ApiRepository;

    expect(visibleHistoryRunSteps({
      repo,
      organizationId: 'org-1',
      threadId: 'thread-1',
      historyMessages: [],
      currentRunId: 'current',
    })).toEqual([step('crashed', 'call-1')]);
  });
});
