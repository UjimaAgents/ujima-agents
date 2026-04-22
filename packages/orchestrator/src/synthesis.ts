import type { ContextStore, ApprovalTracker } from '@ujima/context-store';
import type { AgentRunResult } from '@ujima/agent-runtime';
import type { TaskSynthesis } from './types';

export interface SynthesizeInputs {
  taskId: string;
  context: ContextStore;
  approvals: ApprovalTracker;
  agentResults: AgentRunResult[];
}

export async function synthesizeTask(inputs: SynthesizeInputs): Promise<TaskSynthesis> {
  const { taskId, approvals, agentResults } = inputs;
  const pending = await approvals.listByTask(taskId, 'pending_approval');

  const agents = agentResults.map((r) => ({
    agentId: r.agentId,
    exitReason: r.exitReason,
    finalText: r.finalText,
    outputKey: `task:${taskId}:agent:${r.agentId}:output`,
  }));

  const summaryLines: string[] = [`Task ${taskId} ran ${agentResults.length} agent(s).`];
  for (const r of agentResults) {
    summaryLines.push(`- ${r.agentId}: ${r.exitReason} (${r.toolCalls} tool calls)`);
  }
  if (pending.length > 0) {
    summaryLines.push(`${pending.length} approval(s) pending.`);
  }

  return {
    summary: summaryLines.join('\n'),
    agents,
    pendingApprovals: pending.map((a) => ({
      id: a.id,
      agentId: a.proposed_by ?? 'unknown',
      artifactKey: a.artifact_key,
      domain: a.domain,
    })),
  };
}
