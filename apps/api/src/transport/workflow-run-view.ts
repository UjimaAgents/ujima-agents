import type { Repository } from '@ujima/runtime-core';
import { normalizeWorkflowGraph, type WorkflowNodeRun, type WorkflowRun } from '@ujima/shared';

export interface WorkflowToolStepView {
  tool: string;
  action: string;
  status: string;
  resourcePath?: string;
  at: string;
}

export type WorkflowNodeRunView = WorkflowNodeRun & {
  agentName?: string;
  failureDetail?: string;
  toolSteps: WorkflowToolStepView[];
};

export interface WorkflowRunMessageView {
  id: string;
  senderName: string;
  senderKind: string;
  content: string;
  createdAt: string;
}

export interface WorkflowBlockingApprovalView {
  id: string;
  nodeId?: string;
  agentName?: string;
  resourceType: string;
  action: string;
  resourcePath: string;
}

export interface WorkflowRunView {
  run: WorkflowRun;
  nodeRuns: WorkflowNodeRunView[];
  messages: WorkflowRunMessageView[];
  blockingApprovals: WorkflowBlockingApprovalView[];
}

export interface WorkflowApprovalView {
  id: string;
  workflowRunId: string;
  workflowName: string;
  nodeId: string;
  prompt: string;
  priorSummary?: string;
  priorOutputPath?: string;
  channelId: string;
  requestedBy: string;
  createdAt: string;
}

export interface WorkflowToolApprovalView {
  id: string;
  workflowRunId: string;
  workflowName: string;
  nodeId: string;
  requestedByMemberId?: string;
  agentName: string;
  resourceType: string;
  action: string;
  resourcePath: string;
  channelId: string;
  createdAt: string;
}

const WORKFLOW_STATUS_CARD = /^\s*(▶|✅|⛔|⚠️)\s*Workflow\b/;
const CONVERSATION_SUMMARY = /^\s*\[\[CONVERSATION_SUMMARY/;

/** Build the bounded run snapshot consumed by every run-detail surface. */
export function buildWorkflowRunView(repo: Repository, run: WorkflowRun): WorkflowRunView {
  const organizationId = run.organizationId;
  const memberById = new Map(repo.listMembers(organizationId).map((member) => [member.id, member]));
  const memberName = (id: string | null | undefined) =>
    id ? (memberById.get(id)?.name ?? id) : undefined;

  const rawNodeRuns = repo.listWorkflowNodeRuns(run.id);
  const childRunIds = [...new Set(rawNodeRuns.flatMap((nodeRun) =>
    nodeRun.childRunId ? [nodeRun.childRunId] : [],
  ))];
  const childRuns = repo.listRunsByIds?.(organizationId, childRunIds) ??
    childRunIds
      .map((childRunId) => repo.getRun(organizationId, childRunId))
      .filter((childRun): childRun is NonNullable<typeof childRun> => childRun !== null);
  const childRunById = new Map(childRuns.map((childRun) => [childRun.id, childRun]));
  const stepRows = repo.listRunStepsByRunIds?.(organizationId, childRunIds, 60) ??
    childRunIds.flatMap((childRunId) => repo.listRunSteps?.(organizationId, childRunId)?.slice(-60) ?? []);
  const stepsByRunId = new Map<string, typeof stepRows>();
  for (const step of stepRows) {
    const steps = stepsByRunId.get(step.runId) ?? [];
    steps.push(step);
    stepsByRunId.set(step.runId, steps);
  }

  const nodeRuns = rawNodeRuns.map((nodeRun): WorkflowNodeRunView => {
    const childSummary = nodeRun.childRunId
      ? childRunById.get(nodeRun.childRunId)?.summary
      : undefined;
    return {
      ...nodeRun,
      agentName: memberName(nodeRun.agentId),
      failureDetail:
        nodeRun.status === 'failed' && childSummary && childSummary !== nodeRun.failureReason
          ? childSummary
          : undefined,
      toolSteps: nodeRun.childRunId
        ? (stepsByRunId.get(nodeRun.childRunId) ?? []).map((step) => ({
            tool: step.toolId,
            action: step.action,
            status: step.status,
            resourcePath: step.resourcePath || undefined,
            at: step.createdAt,
          }))
        : [],
    };
  });

  const childNodeByRun = new Map(
    nodeRuns
      .filter((nodeRun) => nodeRun.childRunId)
      .map((nodeRun) => [nodeRun.childRunId as string, nodeRun.nodeId]),
  );
  const blockingApprovals = repo
    .listPendingApprovals(organizationId)
    .filter((approval) => approval.runId && childNodeByRun.has(approval.runId))
    .map((approval) => ({
      id: approval.id,
      nodeId: childNodeByRun.get(approval.runId as string),
      agentName: memberName(approval.requestedBy),
      resourceType: approval.resourceType,
      action: approval.action,
      resourcePath: approval.resourcePath,
    }));

  const messages = repo
    .listMessages(organizationId, run.threadId, undefined, 100)
    .data
    .slice()
    .reverse()
    .filter((message) => !WORKFLOW_STATUS_CARD.test(message.content ?? '') && !CONVERSATION_SUMMARY.test(message.content ?? ''))
    .map((message) => ({
      id: message.id,
      senderName: memberName(message.senderId) ?? message.senderId,
      senderKind: message.senderKind,
      content: message.content,
      createdAt: message.createdAt,
    }));

  return { run, nodeRuns, messages, blockingApprovals };
}

/** Build the bounded approval queue shared by the run surfaces and global pill. */
export function buildWorkflowApprovalView(repo: Repository, organizationId: string): {
  approvals: WorkflowApprovalView[];
  toolApprovals: WorkflowToolApprovalView[];
} {
  const memberById = new Map(repo.listMembers(organizationId).map((member) => [member.id, member]));
  const memberName = (id: string | null | undefined) =>
    id ? (memberById.get(id)?.name ?? id) : undefined;
  const approvals: WorkflowApprovalView[] = [];

  for (const run of repo.listWorkflowRuns(organizationId, 'awaiting_approval')) {
    const nodeRuns = repo.listWorkflowNodeRuns(run.id);
    const gates = nodeRuns.filter((nodeRun) => nodeRun.status === 'awaiting_approval');
    if (gates.length === 0) continue;
    const promptByNode = new Map<string, string | undefined>();
    try {
      const graph = normalizeWorkflowGraph(JSON.parse(run.graphSnapshot));
      for (const node of graph.nodes) {
        if (node.kind === 'approval') promptByNode.set(node.id, node.config.prompt);
      }
    } catch {
      // A malformed historical snapshot should not hide the live gate.
    }
    const lastCompleted = nodeRuns
      .filter((nodeRun) => nodeRun.status === 'completed')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
    for (const gate of gates) {
      approvals.push({
        id: gate.approvalRequestId ?? gate.id,
        workflowRunId: run.id,
        workflowName: run.name,
        nodeId: gate.nodeId,
        prompt: promptByNode.get(gate.nodeId) ?? '',
        priorSummary: lastCompleted?.summary ?? undefined,
        priorOutputPath: lastCompleted?.outputPath ?? undefined,
        channelId: run.channelId,
        requestedBy: run.initiatedBy,
        createdAt: gate.startedAt ?? run.createdAt,
      });
    }
  }

  const toolApprovals: WorkflowToolApprovalView[] = [];
  const pending = repo.listPendingApprovals(organizationId);
  for (const run of repo.listWorkflowRuns(organizationId, 'running')) {
    const childNodeByRun = new Map(
      repo
        .listWorkflowNodeRuns(run.id)
        .filter((nodeRun) => nodeRun.childRunId)
        .map((nodeRun) => [
          nodeRun.childRunId as string,
          { nodeId: nodeRun.nodeId, agentId: nodeRun.agentId, agentName: memberName(nodeRun.agentId) },
        ]),
    );
    for (const approval of pending) {
      const link = approval.runId ? childNodeByRun.get(approval.runId) : undefined;
      if (!link) continue;
      toolApprovals.push({
        id: approval.id,
        workflowRunId: run.id,
        workflowName: run.name,
        nodeId: link.nodeId,
        requestedByMemberId: link.agentId ?? approval.requestedBy,
        agentName: link.agentName ?? memberName(approval.requestedBy) ?? approval.requestedBy,
        resourceType: approval.resourceType,
        action: approval.action,
        resourcePath: approval.resourcePath,
        channelId: run.channelId,
        createdAt: approval.createdAt,
      });
    }
  }

  return { approvals, toolApprovals };
}
