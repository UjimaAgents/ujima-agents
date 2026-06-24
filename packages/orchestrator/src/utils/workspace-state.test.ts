import { describe, expect, it } from 'vitest';
import { buildWorkspaceStateBlock } from './workspace-state.js';

describe('buildWorkspaceStateBlock', () => {
  it('surfaces recent workspace artifacts written within the lookback window', async () => {
    const repo = {
      listRecentWorkspaceArtifacts: () => [
        {
          path: 'apps/web/src/feature.tsx',
          writtenBy: 'agent-1',
          channelId: 'channel-1',
          updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          sizeBytes: 1024,
        },
      ],
      getMember: () => ({ id: 'agent-1', name: 'Ava' }),
    };

    const block = await buildWorkspaceStateBlock({
      organizationId: 'org-1',
      memberId: 'agent-1',
      channelId: 'channel-1',
      repo: repo as never,
    });

    expect(block).not.toBeNull();
    expect(block).toContain('<recent-artifacts>');
    expect(block).toContain('apps/web/src/feature.tsx');
    // Writer is resolved to a display name.
    expect(block).toContain('Ava');
  });

  it('surfaces channel-scoped recent decisions', async () => {
    const repo = {
      listDecisionLogForChannel: () => [
        {
          id: 'd1',
          organizationId: 'org-1',
          channelId: 'channel-1',
          decidedAt: '2026-06-23T10:00:00.000Z',
          decidedBy: 'agent-1',
          decisionText: 'Ship the queue first',
          sourceMessageId: 'msg-1',
          createdAt: '2026-06-23T10:00:00.000Z',
        },
      ],
    };

    const block = await buildWorkspaceStateBlock({
      organizationId: 'org-1',
      memberId: 'agent-1',
      channelId: 'channel-1',
      repo: repo as never,
    });

    expect(block).not.toBeNull();
    expect(block).toContain('<recent-decisions>');
    expect(block).toContain('Ship the queue first');
  });

  it('returns null when there is nothing to surface', async () => {
    const repo = {
      listRecentWorkspaceArtifacts: () => [],
      listDecisionLogForChannel: () => [],
    };

    const block = await buildWorkspaceStateBlock({
      organizationId: 'org-1',
      memberId: 'agent-1',
      channelId: 'channel-1',
      repo: repo as never,
    });

    expect(block).toBeNull();
  });
});
