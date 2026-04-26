import { describe, expect, it } from 'vitest';
import {
  channelDmTool,
  channelListTool,
  channelPostTool,
  channelReadTool,
  channelReplyTool,
  selfNoteTool,
} from './channel.js';

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
    expect(inv.permissionToolName).toBe('post');
    expect(inv.action).toBe('message');
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

  it('self.note keeps its bypassPermission flag', () => {
    const inv = selfNoteTool.toInvocation({ body: 'thinking…' });
    expect(inv.bypassPermission).toBe(true);
    expect(inv.resourcePath).toBeUndefined();
  });
});
