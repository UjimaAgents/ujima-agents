import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from '@ujima/shared';
import { buildWorkspaceStateBlock } from './workspace-state.js';

describe('buildWorkspaceStateBlock', () => {
  it('prefers memory linked to the active thread', async () => {
    const entry = (
      key: string,
      createdAt: string,
      metadata: Record<string, unknown> = {},
    ): MemoryEntry => ({
      id: key,
      organizationId: 'org-1',
      memberId: 'agent-1',
      kind: 'fact',
      key,
      content: key,
      metadata,
      createdAt,
    });
    const repo = {
      recallMemoryEntries: () => [
        entry('recent-other-thread', '2026-06-14T12:00:00.000Z'),
        entry('linked-thread', '2026-06-13T12:00:00.000Z', { threadId: 'thread-1' }),
      ],
    };

    const block = await buildWorkspaceStateBlock({
      organizationId: 'org-1',
      memberId: 'agent-1',
      threadId: 'thread-1',
      repo: repo as never,
    });

    expect(block).not.toBeNull();
    expect(block!.indexOf('linked-thread')).toBeLessThan(
      block!.indexOf('recent-other-thread'),
    );
  });
});
