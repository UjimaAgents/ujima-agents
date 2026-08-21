import { describe, expect, it } from 'vitest';
import type { Repository } from '@ujima/runtime-core';
import type { WorkflowRun } from '@ujima/shared';
import { buildWorkflowRunView } from '../src/transport/workflow-run-view.js';

describe('buildWorkflowRunView', () => {
  it('bounds child steps and removes workflow status noise in one projection', () => {
    const run = {
      id: 'workflow-1',
      organizationId: 'org-1',
      definitionId: null,
      name: 'Research',
      graphSnapshot: '{}',
      graphSha256: 'hash',
      input: null,
      status: 'running',
      initiatedBy: 'human-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      originThreadId: null,
      lastTransitionToken: null,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:01.000Z',
    } as WorkflowRun;
    const repo = {
      listMembers: () => [
        { id: 'agent-1', name: 'Ava' },
        { id: 'human-1', name: 'Owner' },
      ],
      listWorkflowNodeRuns: () => [{
        id: 'node-run-1', workflowRunId: run.id, nodeId: 'agent-node', attempt: 1,
        kind: 'agent', agentId: 'agent-1', childRunId: 'child-1', outputPath: null,
        outputSha256: null, outputSizeBytes: null, outputJson: undefined, summary: null,
        approvalRequestId: null, status: 'completed', failureReason: null,
        startedAt: null, completedAt: null,
      }],
      listRunsByIds: () => [{ id: 'child-1', summary: 'done' }],
      listRunStepsByRunIds: () => [{
        runId: 'child-1', toolId: 'view', action: 'read', status: 'ok',
        resourcePath: 'apps/web/page.tsx', createdAt: '2026-08-12T00:00:02.000Z',
      }],
      listPendingApprovals: () => [],
      listMessages: () => ({ data: [
        { id: 'status', senderId: 'human-1', senderKind: 'human', content: '▶ Workflow started', createdAt: '2026-08-12T00:00:00.001Z' },
        { id: 'chat', senderId: 'agent-1', senderKind: 'agent', content: 'hello', createdAt: '2026-08-12T00:00:00.002Z' },
      ] }),
    } as unknown as Repository;

    const view = buildWorkflowRunView(repo, run);

    expect(view.nodeRuns[0]?.agentName).toBe('Ava');
    expect(view.nodeRuns[0]?.toolSteps).toHaveLength(1);
    expect(view.messages.map((message) => message.id)).toEqual(['chat']);
  });
});
