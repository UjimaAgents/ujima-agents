import { describe, expect, it } from 'vitest';
import {
  channelDmTool,
  channelListTool,
  channelPostTool,
  channelReadTool,
  channelReplyTool,
  selfNoteTool,
} from './channel.js';
import { ALWAYS_AVAILABLE_AGENT_TOOLS } from './index.js';

// These assertions guard the second regression: channel/message ids are NOT
// filesystem paths. If `toInvocation` ever re-introduces `resourcePath`, the
// upstream policy check (`checkToolPolicy`) will run them through
// `assertWorkspaceBoundary` + per-role scope matching and reject narrow-scoped
// agents (e.g. `frontend-engineer` scoped to `apps/web`).
describe('channel.* tools — toInvocation()', () => {
  it('channel.post does not emit resourcePath', () => {
    const inv = channelPostTool.toInvocation({
      channel_id: 'general',
      body: 'hi',
      mentions: [],
    });
    expect(inv.resourcePath).toBeUndefined();
    expect(inv.permissionMcpId).toBe('channels');
    // permissionToolName intentionally NOT overridden — see the regression
    // assertions below for the full rationale.
    expect(inv.permissionToolName).toBeUndefined();
    expect(inv.action).toBe('message');
  });

  it('channel.post resolves a friendly channel name to the stored channel id', async () => {
    let receivedChannelId: string | undefined;
    await channelPostTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'channel.post',
        action: 'message',
        resourceType: 'message',
        input: { channel_id: 'general', body: 'hi', mentions: [] },
      } as never,
      team: {
        getChannel: (name: string) => (name === 'general' ? { id: 'channel-general' } : undefined),
      } as never,
      repo: {
        getChannel: (_orgId: string, channelId: string) =>
          channelId === 'channel-general' ? ({ id: 'channel-general' } as never) : null,
        listAllChannels: () => [],
      } as never,
      conversations: {
        postToChannel: (input: { channelId: string }) => {
          receivedChannelId = input.channelId;
          return input;
        },
      } as never,
    });
    expect(receivedChannelId).toBe('channel-general');
  });

  it('channel.reply does not emit resourcePath', () => {
    const inv = channelReplyTool.toInvocation({
      message_id: 'msg_1',
      body: 'hi',
      mentions: [],
    });
    expect(inv.resourcePath).toBeUndefined();
  });

  it('channel.dm does not emit resourcePath', () => {
    const inv = channelDmTool.toInvocation({
      member_id: 'alex',
      body: 'hi',
      mentions: [],
    });
    expect(inv.resourcePath).toBeUndefined();
  });

  it('channel.dm forwards ignore through to the invocation payload', () => {
    const inv = channelDmTool.toInvocation({
      member_id: 'alex',
      body: 'hi',
      mentions: [],
      ignore: true,
    });
    expect(inv.input).toMatchObject({ ignore: true });
  });

  it('channel.list is tagged as a read', () => {
    const inv = channelListTool.toInvocation({ scope: 'mine' });
    expect(inv.action).toBe('read');
    expect(inv.resourcePath).toBeUndefined();
  });

  it('channel.read is tagged as a read and does not emit resourcePath', () => {
    const inv = channelReadTool.toInvocation({
      channel_id: 'general',
      limit: 50,
    });
    expect(inv.action).toBe('read');
    expect(inv.resourcePath).toBeUndefined();
  });

  // Regression: previously each channel.* tool overrode `permissionToolName`
  // to a short name (`post`, `reply`, `dm`, `list`, `read`). The permissions
  // middleware checks `toolName` against the role's `allowed_tools`, which
  // contains the full ids (`channel.post`, …), so every channel call was
  // denied before checkToolPolicy could even run. The fix is to NOT override
  // permissionToolName so it falls through to the full tool id.
  it.each([
    ['channel.post', channelPostTool, { channel_id: 'general', body: 'hi', mentions: [] }],
    ['channel.reply', channelReplyTool, { message_id: 'msg_1', body: 'hi', mentions: [] }],
    ['channel.dm', channelDmTool, { member_id: 'alex', body: 'hi', mentions: [] }],
    ['channel.list', channelListTool, { scope: 'mine' as const }],
    ['channel.read', channelReadTool, { channel_id: 'general', limit: 50 }],
  ])(
    '%s does not override permissionToolName (so it matches `allowed_tools` full ids)',
    (_id, tool, args) => {
      const inv = tool.toInvocation(args as never);
      expect(inv.permissionToolName).toBeUndefined();
      // Still grouped under the `channels` pseudo-MCP for IAM-matrix policy.
      expect(inv.permissionMcpId).toBe('channels');
    },
  );

  it('self.note keeps its bypassPermission flag', () => {
    const inv = selfNoteTool.toInvocation({ body: 'thinking…' });
    expect(inv.bypassPermission).toBe(true);
    expect(inv.resourcePath).toBeUndefined();
  });
});

// Regression: ALWAYS_AVAILABLE_AGENT_TOOLS should stay tiny. Only self.note
// is unconditional; chat tools must remain in the role's normal `tools`
// declaration so the role surface stays explicit.
describe('ALWAYS_AVAILABLE_AGENT_TOOLS', () => {
  it('contains exactly self.note (no chat tools leak past the role allowlist)', () => {
    expect([...ALWAYS_AVAILABLE_AGENT_TOOLS]).toEqual(['self.note']);
  });

  it.each(['channel.post', 'channel.reply', 'channel.dm', 'channel.list', 'channel.read'])(
    'does not include %s',
    (toolId) => {
      expect([...ALWAYS_AVAILABLE_AGENT_TOOLS]).not.toContain(toolId);
    },
  );
});
