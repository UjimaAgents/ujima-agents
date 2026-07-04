import { MemoryReviewService } from './memory-review.js';
import { SchedulerService } from './scheduler.js';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import type { ApiServiceContext } from './context.js';
import type { SpiritService } from './spirit.js';
import type { GoalSystemService } from './goal-system.js';
import type { TeamStore } from './team-store.js';
import type { ToolService } from './tool-service.js';
import type { AiService } from '../ai-service.js';
import { cleanupExpiredAgentAttachments } from './agent-attachment-capture.js';
import { TrajectoryService } from './trajectory.js';

export interface SchedulerDomainInput {
  repo: ApiRepository;
  teamStore: TeamStore;
  realtime: ApiServiceContext['realtime'];
  conversations: ConversationService;
  spirits: SpiritService;
  tools: ToolService;
  ai: AiService;
  goals: GoalSystemService;
  attachmentStoreRoot: string;
  getOrganizationIdsForSweep: () => string[];
}

export interface SchedulerDomainOutput {
  memoryReview: MemoryReviewService;
  scheduler: SchedulerService;
  trajectory: TrajectoryService;
}

export function createSchedulerDomain(input: SchedulerDomainInput): SchedulerDomainOutput {
  const memoryReview = new MemoryReviewService(
    input.teamStore,
    input.repo,
    input.tools,
    input.ai,
  );

  const scheduler = new SchedulerService(input.repo, input.conversations, input.realtime, {
    onHeartbeat: async (job) => {
      if (!job.channelId) return;
      await input.spirits.createRun({
        organizationId: job.organizationId,
        agentId: job.memberId,
        threadId: job.channelId,
        summary: `Heartbeat: ${job.name}`,
        wakeReason: 'heartbeat',
      });
    },
    onSelfImprovement: async (job) => {
      if (!job.channelId) return;
      await memoryReview?.runManual({
        organizationId: job.organizationId,
        memberId: job.memberId,
        channelId: job.channelId,
        triggerType: 'manual',
      });
    },
    onTick: async () => {
      await input.goals.sweepAllPendingTasks();
      cleanupExpiredAgentAttachments({
        repo: input.repo,
        attachmentStoreRoot: input.attachmentStoreRoot,
        organizationIds: input.getOrganizationIdsForSweep(),
      });
    },
  });

  const trajectory = new TrajectoryService();

  return { memoryReview, scheduler, trajectory };
}
