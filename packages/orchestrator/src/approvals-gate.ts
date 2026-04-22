import type { UjimaEvent } from '@ujima/shared';
import type { EventBus } from '@ujima/event-bus';
import type { ApprovalTracker } from '@ujima/context-store';
import { ORCHESTRATOR_EVENT_CHANNEL } from './types';

export interface ApprovalsGateInputs {
  eventBus: EventBus;
  approvals: ApprovalTracker;
  taskId: string;
  sessionId: string;
  channels: string[];
  defaultDomain?: string;
}

export interface ApprovalsGateHandle {
  stop(): void;
  pendingCount(): number;
}

export function wireApprovalsGate(inputs: ApprovalsGateInputs): ApprovalsGateHandle {
  const { eventBus, approvals, taskId, sessionId, channels, defaultDomain = 'general' } = inputs;
  let pending = 0;
  const unsubs: (() => void)[] = [];

  const handler = async (event: UjimaEvent): Promise<void> => {
    if (event.type !== 'review_required') return;
    const payload = event.payload as {
      condition?: string;
      partial_output?: string;
      escalate_to?: string;
    } | null;
    const approvalId = `ap_${event.event_id}`;
    const artifactKey = `task:${taskId}:agent:${event.publisher}:partial`;
    await approvals.propose({
      id: approvalId,
      task_id: taskId,
      artifact_key: artifactKey,
      domain: defaultDomain,
      proposed_by: event.publisher,
    });
    pending++;
    await eventBus.publish(ORCHESTRATOR_EVENT_CHANNEL, {
      event_id: `orc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'approval_requested',
      publisher: 'orchestrator',
      timestamp: new Date().toISOString(),
      task_id: taskId,
      session_id: sessionId,
      payload: {
        kind: 'approval_requested',
        approval_id: approvalId,
        agent_id: event.publisher,
        condition: payload?.condition,
        partial_output: payload?.partial_output,
        escalate_to: payload?.escalate_to,
        artifact_key: artifactKey,
      },
    });
  };

  for (const channel of channels) {
    unsubs.push(eventBus.subscribe(channel, (e) => void handler(e)));
  }

  return {
    stop() {
      for (const u of unsubs) u();
    },
    pendingCount: () => pending,
  };
}
