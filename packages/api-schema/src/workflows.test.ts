import { describe, expect, it } from 'vitest';
import {
  WorkflowApprovalsResponseSchema,
  WorkflowApprovalViewSchema,
  WorkflowNodeRunViewSchema,
  WorkflowRunViewSchema,
  WorkflowToolApprovalViewSchema,
} from './workflows.js';

/** Wire fixture shaped exactly like `buildWorkflowRunView`'s return value. */
const runViewFixture = {
  run: {
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
  },
  nodeRuns: [
    {
      id: 'node-run-1',
      workflowRunId: 'workflow-1',
      nodeId: 'agent-node',
      attempt: 1,
      kind: 'agent',
      agentId: 'agent-1',
      childRunId: 'child-1',
      outputPath: null,
      outputSha256: null,
      outputSizeBytes: null,
      outputJson: undefined,
      summary: null,
      approvalRequestId: null,
      status: 'completed',
      failureReason: null,
      startedAt: null,
      completedAt: null,
      agentName: 'Ava',
      failureDetail: undefined,
      toolSteps: [
        {
          tool: 'view',
          action: 'read',
          status: 'ok',
          resourcePath: 'apps/web/page.tsx',
          at: '2026-08-12T00:00:02.000Z',
        },
        {
          tool: 'write',
          action: 'write',
          status: 'ok',
          at: '2026-08-12T00:00:03.000Z',
        },
      ],
    },
  ],
  messages: [
    {
      id: 'msg-1',
      senderName: 'Owner',
      senderKind: 'human',
      content: 'hello',
      createdAt: '2026-08-12T00:00:02.000Z',
    },
  ],
  blockingApprovals: [
    {
      id: 'approval-1',
      nodeId: 'agent-node',
      agentName: 'Ava',
      resourceType: 'file',
      action: 'write',
      resourcePath: 'apps/web/page.tsx',
    },
  ],
} as const;

describe('workflow run view wire contract', () => {
  it('parses the producer-shaped run view', () => {
    const parsed = WorkflowRunViewSchema.parse(runViewFixture);
    expect(parsed.run.id).toBe('workflow-1');
    expect(parsed.nodeRuns[0]?.agentName).toBe('Ava');
    expect(parsed.nodeRuns[0]?.toolSteps[0]?.tool).toBe('view');
    expect(parsed.messages[0]?.id).toBe('msg-1');
    expect(parsed.blockingApprovals[0]?.action).toBe('write');
  });

  it('round-trips through JSON serialization unchanged', () => {
    const throughWire = JSON.parse(JSON.stringify(runViewFixture));
    expect(WorkflowRunViewSchema.parse(throughWire)).toEqual(runViewFixture);
  });

  it('pins toolSteps as REQUIRED on the wire (producer always emits it)', () => {
    const nodeRun = runViewFixture.nodeRuns[0]!;
    const { toolSteps: _dropped, ...withoutToolSteps } = nodeRun;
    const result = WorkflowNodeRunViewSchema.safeParse(withoutToolSteps);
    if (result.success) {
      throw new Error('expected parse to fail without toolSteps');
    }
    expect(result.error.issues[0]?.path.join('.')).toContain('toolSteps');
  });

  it('parses a node run with no decorations (no agent, no tool steps)', () => {
    const parsed = WorkflowNodeRunViewSchema.parse({
      ...runViewFixture.nodeRuns[0],
      agentId: null,
      childRunId: null,
      agentName: undefined,
      failureDetail: undefined,
      toolSteps: [],
    });
    expect(parsed.toolSteps).toEqual([]);
    expect(parsed.agentName).toBeUndefined();
  });

  it('parses approval queue views', () => {
    const approvals = {
      approvals: [
        {
          id: 'approval-gate-1',
          workflowRunId: 'workflow-1',
          workflowName: 'Research',
          nodeId: 'gate-node',
          prompt: 'Approve the brief?',
          priorSummary: 'BRD v1',
          priorOutputPath: 'docs/wf/brd.md',
          channelId: 'channel-1',
          requestedBy: 'human-1',
          createdAt: '2026-08-12T00:00:04.000Z',
        },
      ],
      toolApprovals: [
        {
          id: 'tool-approval-1',
          workflowRunId: 'workflow-2',
          workflowName: 'Deploy',
          nodeId: 'deploy-node',
          requestedByMemberId: 'agent-1',
          agentName: 'Ava',
          resourceType: 'file',
          action: 'write',
          resourcePath: 'apps/web/page.tsx',
          channelId: 'channel-2',
          createdAt: '2026-08-12T00:00:05.000Z',
        },
      ],
    };
    const parsed = WorkflowApprovalsResponseSchema.parse(approvals);
    expect(parsed.approvals[0]?.priorSummary).toBe('BRD v1');
    expect(parsed.toolApprovals[0]?.requestedByMemberId).toBe('agent-1');
    expect(WorkflowApprovalViewSchema.parse(approvals.approvals[0])).toBeTruthy();
    expect(WorkflowToolApprovalViewSchema.parse(approvals.toolApprovals[0])).toBeTruthy();
  });

  it('round-trips the approval queue through JSON serialization unchanged', () => {
    const approvals = {
      approvals: [
        {
          id: 'approval-gate-1',
          workflowRunId: 'workflow-1',
          workflowName: 'Research',
          nodeId: 'gate-node',
          prompt: 'Approve the brief?',
          channelId: 'channel-1',
          requestedBy: 'human-1',
          createdAt: '2026-08-12T00:00:04.000Z',
        },
      ],
      toolApprovals: [
        {
          id: 'tool-approval-1',
          workflowRunId: 'workflow-2',
          workflowName: 'Deploy',
          nodeId: 'deploy-node',
          agentName: 'Ava',
          resourceType: 'file',
          action: 'write',
          resourcePath: 'apps/web/page.tsx',
          channelId: 'channel-2',
          createdAt: '2026-08-12T00:00:05.000Z',
        },
      ],
    };
    const throughWire = JSON.parse(JSON.stringify(approvals));
    expect(WorkflowApprovalsResponseSchema.parse(throughWire)).toEqual(approvals);
  });
});