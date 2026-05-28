import { describe, expect, it } from 'vitest';
import {
  channelDmTool,
  channelHandoffTool,
  channelListTool,
  channelPassTool,
  channelPostTool,
  channelReadTool,
  channelReplyTool,
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

  it('buildDmSchemaForOrg accepts human members as DM recipients', () => {
    const schema = channelDmTool.buildSchema?.({
      organizationId: 'org-1',
      memberId: 'agent-1',
      repo: {
        listMembers: () => [
          { id: 'agent-1', name: 'Agent One', kind: 'agent' },
          { id: 'human-1', name: 'Pat', kind: 'human' },
        ],
      },
    } as never);
    expect(schema).toBeDefined();
    const parsed = schema!.safeParse({ member_id: 'human-1', body: 'hi', mentions: [] });
    expect(parsed.success).toBe(true);
    const byName = schema!.safeParse({ member_id: 'Pat', body: 'hi', mentions: [] });
    expect(byName.success).toBe(true);
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

  it('channel.read resolves a DM recipient id to the DM thread id', async () => {
    let receivedChannelId: string | undefined;
    await channelReadTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'channel.read',
        action: 'read',
        resourceType: 'message',
        input: { channel_id: 'agent-2', limit: 50 },
      } as never,
      team: {
        getChannel: () => undefined,
      } as never,
      repo: {
        getChannel: () => null,
        listAllChannels: () => [],
        getMember: (_orgId: string, memberId: string) =>
          memberId === 'agent-2' ? ({ id: 'agent-2' } as never) : null,
      } as never,
      conversations: {
        readChannel: (input: { channelId: string }) => {
          receivedChannelId = input.channelId;
          return input;
        },
      } as never,
    });
    expect(receivedChannelId).toBe('dm:agent-1:agent-2');
  });

  it('channel.read normalizes dm:{singleMemberId} to a canonical DM thread id', async () => {
    let receivedChannelId: string | undefined;
    await channelReadTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'channel.read',
        action: 'read',
        resourceType: 'message',
        input: { channel_id: 'dm:agent-2', limit: 50 },
      } as never,
      team: { getChannel: () => undefined } as never,
      repo: {
        getChannel: () => null,
        listAllChannels: () => [],
        getMember: () => null,
        listMembers: () => [],
      } as never,
      conversations: {
        readChannel: (input: { channelId: string }) => {
          receivedChannelId = input.channelId;
          return input;
        },
      } as never,
    });
    expect(receivedChannelId).toBe('dm:agent-1:agent-2');
  });

  it('channel.list annotates DM rows with dm_thread_id and dm_peer_member_id', async () => {
    const result = await channelListTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'channel.list',
        action: 'read',
        resourceType: 'message',
        input: { scope: 'mine' },
      } as never,
      team: {} as never,
      repo: {} as never,
      conversations: {
        listVisibleChannels: () => [
          { id: 'general', name: 'general', kind: 'general', topic: '', memberIds: ['agent-1'] },
          {
            id: 'dm:agent-1:agent-2',
            name: 'dm-cole',
            kind: 'dm',
            topic: '',
            memberIds: ['agent-1', 'agent-2'],
          },
        ],
      } as never,
    });
    expect(result).toEqual([
      { id: 'general', name: 'general', kind: 'general', topic: '', memberIds: ['agent-1'] },
      {
        id: 'dm:agent-1:agent-2',
        name: 'dm-cole',
        kind: 'dm',
        topic: '',
        memberIds: ['agent-1', 'agent-2'],
        dm_thread_id: 'dm:agent-1:agent-2',
        dm_peer_member_id: 'agent-2',
      },
    ]);
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

});

// Regression: ALWAYS_AVAILABLE_AGENT_TOOLS includes the baseline
// conversational primitives every agent needs, regardless of role
// config. Without these, an agent whose role declares no `tools`
// ends up with an empty palette and the model improvises (Gemini
// emits tool-call syntax as prose). `channel.handoff` stays OPT-IN
// (must be in role.tools) because it's a workflow primitive, not
// a baseline conversational one.
describe('ALWAYS_AVAILABLE_AGENT_TOOLS', () => {
  it('contains the baseline conversational primitives, read-only workspace tools, and silent terminators', () => {
    expect([...ALWAYS_AVAILABLE_AGENT_TOOLS].sort()).toEqual(
      [
        'channel.ack',
        'channel.dm',
        'channel.list',
        'channel.pass',
        'channel.post',
        'channel.read',
        'channel.recall',
        'channel.reply',
        'glob',
        'grep',
        'ls',
        'memory.forget',
        'memory.recall',
        'memory.write',
        'message',
        'schedule',
        'self.note',
        'procedure.list',
        'procedure.view',
        'self.procedure.add',
        'self.procedure.list',
        'self.procedure.remove',
        'self.procedure.view',
        'view',
      ].sort(),
    );
  });

  it.each(['channel.handoff', 'edit', 'write', 'multiedit', 'shell'])(
    'does NOT include %s (write-capable / workflow opt-in via role.tools)',
    (toolId) => {
      expect([...ALWAYS_AVAILABLE_AGENT_TOOLS]).not.toContain(toolId);
    },
  );
});

// L13 — `already_handled` and `duplicate_reply` reasons require a
// non-empty `note`, so the model has to demonstrate it actually
// checked rather than collapsing every silence to
// `not_addressed_to_me`.
describe('channelPassTool schema refine (L13)', () => {
  it('rejects reason="already_handled" without a note', () => {
    const parsed = channelPassTool.schema.safeParse({ reason: 'already_handled' });
    expect(parsed.success).toBe(false);
  });

  it('rejects reason="duplicate_reply" with an empty note', () => {
    const parsed = channelPassTool.schema.safeParse({
      reason: 'duplicate_reply',
      note: '   ',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts reason="already_handled" with a real note AND citation', () => {
    const parsed = channelPassTool.schema.safeParse({
      reason: 'already_handled',
      note: 'agent-2 just posted the same answer in this thread',
      cited_message_ids: ['msg-agent2-reply-001'],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects reason="already_handled" when cited_message_ids is missing (hallucination guard)', () => {
    const parsed = channelPassTool.schema.safeParse({
      reason: 'already_handled',
      note: 'agent-2 just posted the same answer in this thread',
      // No cited_message_ids — the schema requires it for this reason
      // so the model has to ground the claim in a real message id.
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects reason="duplicate_reply" when cited_message_ids is missing', () => {
    const parsed = channelPassTool.schema.safeParse({
      reason: 'duplicate_reply',
      note: 'I already answered this earlier',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts reason="not_addressed_to_me" without a note', () => {
    const parsed = channelPassTool.schema.safeParse({ reason: 'not_addressed_to_me' });
    expect(parsed.success).toBe(true);
  });

  it('emits the actual validated pass reason', async () => {
    let emittedReason: string | undefined;
    const result = await channelPassTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'call-1',
        toolId: 'channel.pass',
        action: 'message',
        resourceType: 'message',
        input: { reason: 'out_of_scope', note: 'This belongs to another role.' },
        threadId: 'thread-1',
      } as never,
      repo: {
        getRun: () => ({ id: 'run-1', threadId: 'thread-1', sourceMessageId: null }),
        saveRun: () => undefined,
        getThread: () => ({ channelId: 'general' }),
        getMember: () => ({ id: 'agent-1', name: 'Agent One' }),
      } as never,
      team: {} as never,
      conversations: {
        emitAgentPassed: (input: { reason: string }) => {
          emittedReason = input.reason;
        },
        emitDecisionVerification: () => undefined,
      } as never,
    });

    expect(emittedReason).toBe('out_of_scope');
    expect(result).toMatchObject({ status: 'passed', reason: 'out_of_scope' });
  });
});

// channel.handoff stamps [HANDOFF]/[DONE] on the published content
// from the tool side (L6) — the model never types the literal token.
describe('channelHandoffTool', () => {
  it('toInvocation does not emit resourcePath', () => {
    const inv = channelHandoffTool.toInvocation({
      to: 'bob',
      reason: 'Please verify the API contract',
      deliverable: 'Confirm signature shape',
    });
    expect(inv.resourcePath).toBeUndefined();
    expect(inv.permissionMcpId).toBe('channels');
    expect(inv.action).toBe('message');
  });

  it('schema accepts complete: true', () => {
    const parsed = channelHandoffTool.schema.safeParse({
      to: 'bob',
      reason: 'Done',
      deliverable: 'All clear',
      complete: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('schema rejects empty deliverable', () => {
    const parsed = channelHandoffTool.schema.safeParse({
      to: 'bob',
      reason: 'Done',
      deliverable: '',
    });
    expect(parsed.success).toBe(false);
  });

  // Regression: the handoff message was published with
  // `metadata.handoff` but no `runId`. Run-detail views key off
  // `metadata.runId` to associate a tool-posted message with its
  // originating run — without it, `/runs/:id` shows no visible
  // reply even though the tool posted one. The other terminating
  // channel tools (channel.reply / .post / .dm) all set runId in
  // metadata; channel.handoff must match.
  it('execute stamps metadata.runId on the published handoff message', async () => {
    let captured: { metadata?: Record<string, unknown> } | undefined;
    await channelHandoffTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-handoff-1',
        memberId: 'alice',
        threadId: 'thread-1',
        toolCallId: 'call-1',
        toolId: 'channel.handoff',
        action: 'message',
        resourceType: 'message',
        input: {
          to: 'bob',
          reason: 'Hand it off',
          deliverable: 'See the diff',
        },
      } as never,
      team: {} as never,
      repo: {
        getRun: () => null,
        getThread: () => ({ id: 'thread-1', channelId: 'channel-general' }),
        getMember: (_orgId: string, memberId: string) =>
          memberId === 'bob'
            ? { id: 'bob', name: 'Bob', kind: 'agent' }
            : memberId === 'alice'
              ? { id: 'alice', name: 'Alice', kind: 'agent' }
              : null,
        listMembers: () => [],
        saveRun: () => undefined,
      } as never,
      conversations: {
        publishMessage: (message: { metadata?: Record<string, unknown> }) => {
          captured = message;
          return message;
        },
        emitAgentHandoff: () => undefined,
      } as never,
    });

    expect(captured?.metadata).toMatchObject({
      runId: 'run-handoff-1',
      handoff: {
        from: 'alice',
        to: 'bob',
        complete: false,
      },
    });
  });
});
