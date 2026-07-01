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

  describe('channel.dm delivery', () => {
    // Default to a DM-thread context: agent-to-agent / agent-to-human DMs are
    // only allowed when the run originates in a DM thread (see the
    // dm_blocked_in_channel guard). Channel-context runs are exercised
    // separately below by passing a non-DM threadId (or none).
    const baseInvocation = (memberId: string) => ({
      organizationId: 'org-1',
      runId: 'run-1',
      memberId,
      threadId: 'dm:agent-1:agent-2',
      toolCallId: 'call-1',
      toolId: 'channel.dm',
      action: 'message',
      resourceType: 'message',
    });

    const repoWith = (members: Record<string, { id: string; name: string; kind: string }>) =>
      ({
        getMember: (_orgId: string, id: string) => members[id] ?? null,
      }) as never;
    const repoWithRun = (
      members: Record<string, { id: string; name: string; kind: string }>,
      threadId: string,
    ) =>
      ({
        getMember: (_orgId: string, id: string) => members[id] ?? null,
        getRun: () => ({ threadId }),
      }) as never;

    it('allows an agent DMing another agent', async () => {
      let sent = false;
      let recipientId: string | undefined;
      const result = await channelDmTool.execute({
        invocation: { ...baseInvocation('agent-1'), input: { member_id: 'agent-2', body: 'hi', mentions: [] } } as never,
        team: {} as never,
        repo: repoWith({
          'agent-1': { id: 'agent-1', name: 'Layla', kind: 'agent' },
          'agent-2': { id: 'agent-2', name: 'Phoebe', kind: 'agent' },
        }),
        conversations: {
          tryMirrorSuppress: () => false,
          sendDirectMessage: (input: { recipientId: string }) => {
            sent = true;
            recipientId = input.recipientId;
            return { id: 'm1' };
          },
        } as never,
      });
      expect(sent).toBe(true);
      expect(recipientId).toBe('agent-2');
      expect(result).toMatchObject({
        status: 'sent',
        message_sent: true,
        message_id: 'm1',
        recipient_id: 'agent-2',
      });
    });

    it('allows an agent DMing a human', async () => {
      let sent = false;
      await channelDmTool.execute({
        invocation: { ...baseInvocation('agent-1'), input: { member_id: 'human-1', body: 'hi', mentions: [] } } as never,
        team: {} as never,
        repo: repoWith({
          'agent-1': { id: 'agent-1', name: 'Layla', kind: 'agent' },
          'human-1': { id: 'human-1', name: 'Pat', kind: 'human' },
        }),
        conversations: {
          tryMirrorSuppress: () => false,
          sendDirectMessage: () => {
            sent = true;
            return { id: 'm1' };
          },
        } as never,
      });
      expect(sent).toBe(true);
    });

    it('allows a DM run when the invocation omits threadId', async () => {
      let sent = false;
      await channelDmTool.execute({
        invocation: {
          ...baseInvocation('agent-1'),
          threadId: undefined,
          input: { member_id: 'agent-2', body: 'hi', mentions: [] },
        } as never,
        team: {} as never,
        repo: repoWithRun(
          {
            'agent-1': { id: 'agent-1', name: 'Layla', kind: 'agent' },
            'agent-2': { id: 'agent-2', name: 'Phoebe', kind: 'agent' },
          },
          'dm:agent-1:agent-2',
        ),
        conversations: {
          tryMirrorSuppress: () => false,
          sendDirectMessage: () => {
            sent = true;
            return { id: 'm1' };
          },
        } as never,
      });
      expect(sent).toBe(true);
    });

    it('allows a self-DM (scratchpad)', async () => {
      let sent = false;
      await channelDmTool.execute({
        invocation: { ...baseInvocation('agent-1'), input: { member_id: 'self', body: 'note', mentions: [] } } as never,
        team: {} as never,
        repo: repoWith({ 'agent-1': { id: 'agent-1', name: 'Layla', kind: 'agent' } }),
        conversations: {
          tryMirrorSuppress: () => false,
          sendDirectMessage: () => {
            sent = true;
            return { id: 'm1' };
          },
        } as never,
      });
      expect(sent).toBe(true);
    });

    it('blocks DMing a teammate from a channel run (no DM thread)', async () => {
      let sent = false;
      const result = await channelDmTool.execute({
        invocation: {
          ...baseInvocation('agent-1'),
          // Channel-context run: threadId is a channel thread, not a DM.
          threadId: 'channel-thread-1',
          input: { member_id: 'agent-2', body: 'psst', mentions: [] },
        } as never,
        team: {} as never,
        repo: repoWith({
          'agent-1': { id: 'agent-1', name: 'Layla', kind: 'agent' },
          'agent-2': { id: 'agent-2', name: 'Phoebe', kind: 'agent' },
        }),
        conversations: {
          tryMirrorSuppress: () => false,
          sendDirectMessage: () => {
            sent = true;
            return { id: 'm1' };
          },
        } as never,
      });
      expect(sent).toBe(false);
      expect(result).toMatchObject({ status: 'dm_blocked_in_channel', message_sent: false });
    });

    it('still allows a self-note from a channel run', async () => {
      let sent = false;
      await channelDmTool.execute({
        invocation: {
          ...baseInvocation('agent-1'),
          threadId: 'channel-thread-1',
          input: { member_id: 'self', body: 'note', mentions: [] },
        } as never,
        team: {} as never,
        repo: repoWith({ 'agent-1': { id: 'agent-1', name: 'Layla', kind: 'agent' } }),
        conversations: {
          tryMirrorSuppress: () => false,
          sendDirectMessage: () => {
            sent = true;
            return { id: 'm1' };
          },
        } as never,
      });
      expect(sent).toBe(true);
    });
  });

  describe('buildDmSchemaForOrg — conversationKind constraint', () => {
    const ctx = (conversationKind?: 'channel' | 'dm') => ({
      organizationId: 'org-1',
      memberId: 'agent-1',
      conversationKind,
      repo: {
        listMembers: () => [
          { id: 'agent-1', name: 'Agent One', kind: 'agent' },
          { id: 'agent-2', name: 'Phoebe', kind: 'agent' },
        ],
      },
    });

    it('constrains member_id to "self" only for channel runs', () => {
      const schema = channelDmTool.buildSchema?.(ctx('channel') as never);
      expect(schema).toBeDefined();
      expect(schema!.safeParse({ member_id: 'self', body: 'note', mentions: [] }).success).toBe(true);
      expect(schema!.safeParse({ member_id: 'agent-2', body: 'hi', mentions: [] }).success).toBe(false);
    });

    it('keeps the full roster for DM runs', () => {
      const schema = channelDmTool.buildSchema?.(ctx('dm') as never);
      expect(schema).toBeDefined();
      expect(schema!.safeParse({ member_id: 'agent-2', body: 'hi', mentions: [] }).success).toBe(true);
    });
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
        'agent.delegate',
        'channel.ack',
        'channel.dm',
        'channel.list',
        'channel.pass',
        'channel.post',
        'channel.read',
        'channel.recall',
        'channel.reply',
        'glob',
        'goal.start',
        'goal.task.update',
        'grep',
        'ls',
        'memory.forget',
        'memory.recall',
        'memory.write',
        'question.ask',
        'schedule',
        'procedure',
        'skill.read',
        'view',
        'download',
        'edit',
        'fetch',
        'multiedit',
        'shell',
        'web_search',
        'write',
      ].sort(),
    );
  });

  it.each(['channel.handoff'])(
    'does NOT include %s (workflow primitive opt-in via role.tools)',
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

describe('channel.* tools — attachment rollback when publish throws', () => {
  it('channel.post rolls back materialised attachments when conversations.postToChannel throws', async () => {
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } =
      await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const storeRoot = mkdtempSync(join(tmpdir(), 'ujima-rollback-'));
    try {
      // Seed a captured agent_attachment whose file lives at the
      // canonical location. The base64 ref below points at a fresh
      // row the resolver creates inline.
      mkdirSync(join(storeRoot, 'agent-generated', 'org-1', 'run-1'), {
        recursive: true,
      });

      const agentAttachments: { id: string; storagePath: string; byteSize: number }[] = [];
      const userAttachments: { id: string }[] = [];
      const deletedAgent: string[] = [];
      const deletedUser: string[] = [];

      const PNG = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...Array.from({ length: 256 }).map(() => 0x42),
      ]);

      let publishCalls = 0;

      const result = await channelPostTool.execute({
        invocation: {
          organizationId: 'org-1',
          runId: 'run-1',
          memberId: 'agent-1',
          toolCallId: 'call-1',
          toolId: 'channel.post',
          action: 'message',
          resourceType: 'message',
          input: {
            channel_id: 'general',
            body: 'hi',
            mentions: [],
            attachments: [
              { refType: 'base64', value: PNG.toString('base64'), filename: 'shot.png' },
            ],
          },
        } as never,
        team: {
          getChannel: (name: string) =>
            name === 'general' ? { id: 'channel-general' } : undefined,
        } as never,
        repo: {
          getChannel: (_orgId: string, channelId: string) =>
            channelId === 'channel-general' ? ({ id: 'channel-general' } as never) : null,
          getOrganization: () => ({ id: 'org-1', workspace: { root: '/tmp/ws' } }),
          listAllChannels: () => [],
          saveAgentAttachment: (att: { id: string; storagePath: string; byteSize: number }) => {
            agentAttachments.push(att);
            return att;
          },
          saveAttachment: (att: { id: string }) => {
            userAttachments.push(att);
            return att;
          },
          deleteAgentAttachment: (_org: string, id: string) => {
            deletedAgent.push(id);
            const idx = agentAttachments.findIndex((a) => a.id === id);
            if (idx >= 0) agentAttachments.splice(idx, 1);
          },
          deleteAttachment: (_org: string, id: string): number => {
            deletedUser.push(id);
            const idx = userAttachments.findIndex((a) => a.id === id);
            if (idx >= 0) {
              userAttachments.splice(idx, 1);
              return 1;
            }
            return 0;
          },
          getAgentAttachment: (_org: string, id: string) =>
            agentAttachments.find((a) => a.id === id) ?? null,
          saveAuditEvent: () => undefined,
        } as never,
        conversations: {
          tryMirrorSuppress: () => false,
          postToChannel: () => {
            publishCalls += 1;
            throw new Error('synthetic publish failure');
          },
        } as never,
        agentAttachmentRoot: join(storeRoot, 'agent-generated'),
        attachmentStoreRoot: storeRoot,
      }).catch((err) => err);

      // The publish threw — channel.post propagated it.
      expect(publishCalls).toBe(1);
      expect(result).toBeInstanceOf(Error);
      // Rollback ran: the agent_attachment row, the user
      // attachment row, AND the on-disk file are all gone.
      expect(agentAttachments).toHaveLength(0);
      expect(userAttachments).toHaveLength(0);
      expect(deletedAgent.length).toBeGreaterThanOrEqual(1);
      expect(deletedUser.length).toBeGreaterThanOrEqual(1);
      // The base64 ref's on-disk file was written before the publish
      // attempt; the rollback should have unlinked it. We can't
      // predict the filename, but we can assert the dir has nothing
      // in it.
      const dir = join(storeRoot, 'agent-generated', 'org-1', 'run-1');
      const { readdirSync } = await import('node:fs');
      const remaining = existsSync(dir) ? readdirSync(dir) : [];
      // The original file is gone; only the dir scaffold may
      // remain (rmSync force-unlinked the file but kept the dir).
      expect(remaining.filter((f) => f.endsWith('.png'))).toEqual([]);
      void writeFileSync; // silence unused
    } finally {
      rmSync(storeRoot, { recursive: true, force: true });
    }
  });

  it('rollback DELETES the agent_attachments row even when attachmentStoreRoot is absent', async () => {
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } =
      await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const agentRoot = mkdtempSync(join(tmpdir(), 'ujima-agent-gen-'));
    try {
      // Layout matches the on-disk shape commitBytes produces:
      // agentAttachmentRoot already includes the `agent-generated/`
      // segment, so the file lives at <agentRoot>/<org>/<run>/<id>.<ext>.
      mkdirSync(join(agentRoot, 'org-1', 'run-1'), { recursive: true });
      const PNG = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...Array.from({ length: 256 }).map(() => 0x42),
      ]);

      const agentAttachments: { id: string; storagePath: string; byteSize: number }[] = [];
      const userAttachments: { id: string }[] = [];

      const result = await channelPostTool.execute({
        invocation: {
          organizationId: 'org-1',
          runId: 'run-1',
          memberId: 'agent-1',
          toolCallId: 'call-1',
          toolId: 'channel.post',
          action: 'message',
          resourceType: 'message',
          input: {
            channel_id: 'general',
            body: 'hi',
            mentions: [],
            // base64 ref: the commitBytes path runs, materializes
            // an owned agent_attachments row + file, then we throw
            // in postToChannel.
            attachments: [
              { refType: 'base64', value: PNG.toString('base64'), filename: 'shot.png' },
            ],
          },
        } as never,
        team: {
          getChannel: (name: string) =>
            name === 'general' ? { id: 'channel-general' } : undefined,
        } as never,
        repo: {
          getChannel: (_orgId: string, channelId: string) =>
            channelId === 'channel-general' ? ({ id: 'channel-general' } as never) : null,
          getOrganization: () => ({ id: 'org-1', workspace: { root: '/tmp/ws' } }),
          listAllChannels: () => [],
          saveAgentAttachment: (att: { id: string; storagePath: string; byteSize: number }) => {
            agentAttachments.push(att);
            return att;
          },
          saveAttachment: (att: { id: string }) => {
            userAttachments.push(att);
            return att;
          },
          deleteAgentAttachment: (_org: string, id: string) => {
            const idx = agentAttachments.findIndex((a) => a.id === id);
            if (idx >= 0) agentAttachments.splice(idx, 1);
          },
          deleteAttachment: (_org: string, id: string): number => {
            const idx = userAttachments.findIndex((a) => a.id === id);
            if (idx >= 0) {
              userAttachments.splice(idx, 1);
              return 1;
            }
            return 0;
          },
          getAgentAttachment: (_org: string, id: string) =>
            agentAttachments.find((a) => a.id === id) ?? null,
          saveAuditEvent: () => undefined,
        } as never,
        conversations: {
          tryMirrorSuppress: () => false,
          postToChannel: () => {
            throw new Error('synthetic publish failure');
          },
        } as never,
        // attachmentStoreRoot intentionally OMITTED to assert the
        // row delete + file-path fallback still runs.
        agentAttachmentRoot: agentRoot,
      }).catch((err) => err);

      expect(result).toBeInstanceOf(Error);
      // The owned agent_attachments row was deleted even without
      // attachmentStoreRoot wired — pre-fix this was the leak path.
      expect(agentAttachments).toHaveLength(0);
      expect(userAttachments).toHaveLength(0);
      // File was unlinked via the agentAttachmentRoot fallback.
      const runDir = join(agentRoot, 'org-1', 'run-1');
      const { readdirSync } = await import('node:fs');
      const remaining = existsSync(runDir)
        ? readdirSync(runDir).filter((f) => f.endsWith('.png'))
        : [];
      expect(remaining).toEqual([]);
      void writeFileSync; // silence unused
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
    }
  });
});
