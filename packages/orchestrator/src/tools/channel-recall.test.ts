import { describe, expect, it } from 'vitest';
import { channelRecallTool } from './channel-recall.js';

function fakeMessage(input: {
  id: string;
  content: string;
  channelId: string;
  senderId?: string;
  createdAt: string;
}) {
  return {
    id: input.id,
    organizationId: 'org-1',
    threadId: input.channelId,
    channelId: input.channelId,
    senderId: input.senderId ?? 'member-a',
    senderKind: 'human',
    kind: 'human',
    content: input.content,
    mentions: [],
    createdAt: input.createdAt,
  };
}

function fakeContext(input: Record<string, unknown>, overrides: Record<string, unknown>) {
  return {
    invocation: {
      organizationId: 'org-1',
      runId: 'run-1',
      memberId: 'member-a',
      threadId: 'current-channel',
      input,
      action: 'read',
      resourceType: 'message',
    },
    team: { workspace: { root: '/tmp/workspace' } },
    repo: {},
    conversations: {},
    ...overrides,
  } as never;
}

describe('channel.recall', () => {
  it('fans org-scope recall out across all readable public channels', async () => {
    let requestedScope: string | undefined;
    const result = (await channelRecallTool.execute(
      fakeContext(
        { query: 'needle', scope: 'org', limit: 5 },
        {
          conversations: {
            listVisibleChannels: (input: { scope: string }) => {
              requestedScope = input.scope;
              return [{ id: 'public', name: 'public', kind: 'general', memberIds: [] }];
            },
            readChannel: () => ({
              data: [
                fakeMessage({
                  id: 'public-message',
                  content: 'needle in a public channel',
                  channelId: 'public',
                  createdAt: '2026-01-01T00:00:00.000Z',
                }),
              ],
              hasMore: false,
              searchRanks: { 'public-message': -2 },
            }),
          },
        },
      ),
    )) as { hits: { ref: string; channelName?: string }[] };

    expect(requestedScope).toBe('all');
    expect(result.hits).toEqual([
      expect.objectContaining({ ref: 'public-message', channelName: 'public' }),
    ]);
  });

  it('orders message hits by search rank before recency', async () => {
    const result = (await channelRecallTool.execute(
      fakeContext(
        { query: 'needle', scope: 'channel', channel_id: 'current-channel', limit: 2 },
        {
          conversations: {
            readChannel: () => ({
              data: [
                fakeMessage({
                  id: 'newer-weaker',
                  content: 'newer weaker needle hit',
                  channelId: 'current-channel',
                  createdAt: '2026-01-01T00:00:02.000Z',
                }),
                fakeMessage({
                  id: 'older-better',
                  content: 'needle',
                  channelId: 'current-channel',
                  createdAt: '2026-01-01T00:00:01.000Z',
                }),
              ],
              hasMore: false,
              searchRanks: { 'newer-weaker': -1, 'older-better': -5 },
            }),
          },
        },
      ),
    )) as { hits: { ref: string }[] };

    expect(result.hits.map((hit) => hit.ref)).toEqual(['older-better', 'newer-weaker']);
  });
});
