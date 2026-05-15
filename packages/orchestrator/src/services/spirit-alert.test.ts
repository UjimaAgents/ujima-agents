import { describe, expect, it } from 'vitest';
import { AGENT_KIND, type Spirit } from '@ujima/shared';
import { ActiveSpiritRegistry } from './active-spirit-registry.js';
import { SpiritService } from './spirit.js';

describe('SpiritService alert routing', () => {
  it('does not route an alert to a spirit from another task thread', async () => {
    const organizationId = 'org-1';
    const memberId = 'agent-1';
    const registry = new ActiveSpiritRegistry();
    const spirit: Spirit = {
      id: 'spirit-1',
      organizationId,
      taskSessionId: 'task-1',
      memberId,
      role: 'worker',
      runId: 'run-1',
      status: 'running',
      iteration: 0,
      tokensUsed: 0,
      createdAt: '2026-05-14T09:00:00.000Z',
      updatedAt: '2026-05-14T09:00:00.000Z',
    };
    registry.register(spirit);
    const service = new SpiritService(
      {} as never,
      {
        getTaskSession: () => ({
          id: 'task-1',
          organizationId,
          slug: 'task-1',
          status: 'running',
          prompt: 'work',
          channelId: 'task-thread-2',
          teamMemberIds: [memberId],
          origin: {},
          createdBy: 'human-1',
          createdAt: '2026-05-14T09:00:00.000Z',
          updatedAt: '2026-05-14T09:00:00.000Z',
        }),
        listMembers: () => [
          {
            id: memberId,
            organizationId,
            name: 'Agent One',
            kind: AGENT_KIND,
            roleName: 'engineer',
          },
        ],
      } as never,
      { emit: () => undefined } as never,
      {} as never,
      { registry },
    );

    await expect(
      service.handleAlert({
        organizationId,
        memberId,
        threadId: 'task-thread-1',
        channelId: 'task-thread-1',
        messageId: 'message-1',
        byMemberId: 'human-1',
        reason: 'mention',
      }),
    ).resolves.toEqual({ kind: 'no-active-spirit' });
  });
});
