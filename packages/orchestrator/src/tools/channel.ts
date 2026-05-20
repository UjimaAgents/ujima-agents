import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AGENT_KIND,
  ChannelPassReasonSchema,
  MessageSchema,
  channelRoom,
  getDirectMessageThreadId,
  memberRoom,
  orgRoom,
  threadRoom,
} from '@ujima/shared';
import type { BuildSchemaContext } from './types.js';
import type { AgentTeamHandle } from '@ujima/framework';
import type { ApiRepository } from '../services/repository-reader.js';
import { verifyChannelPass } from '../utils/decision-verifier.js';
import type { OrchestratorTool } from './types.js';

const ChannelPostSchema = z.object({
  channel_id: z.string().min(1),
  body: z.string().min(1),
  mentions: z.array(z.string().min(1)).default([]),
});

const ChannelReplySchema = z.object({
  message_id: z.string().min(1),
  body: z.string().min(1),
  mentions: z.array(z.string().min(1)).default([]),
});

const ChannelDmSchema = z.object({
  member_id: z.string().min(1),
  body: z.string().min(1),
  mentions: z.array(z.string().min(1)).default([]),
  ignore: z.boolean().optional(),
});

const ChannelListSchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
});

const ChannelReadSchema = z.object({
  channel_id: z.string().min(1),
  since: z.string().optional(),
  query: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

const SelfNoteSchema = z.object({
  body: z.string().min(1),
});

// `channel.pass` is the first-class "silent" outcome: an agent that
// has nothing to add to a channel message calls this tool with a
// reason and the run terminates without publishing chat text. The
// run-loop sees it via `RUN_TERMINATING_TOOL_NAMES` and skips the
// forced-reply fallback in `run.ts`.
//
// L13: `already_handled` and `duplicate_reply` require a non-empty
// `note` so the model has to demonstrate it actually checked,
// instead of collapsing every silence to `not_addressed_to_me`.
//
// Hallucination-grounding additions (provider-agnostic):
//   - `cited_message_ids`: optional array of message ids from the
//     <thread-state> block that justify this pass. Required for
//     reasons that make factual claims about prior thread state
//     (`already_handled`, `duplicate_reply`).
//   - `quoted_text`: optional short verbatim quote from the cited
//     message. Substring-validated against the actual message
//     content by the shadow-mode verifier — a fabricated quote
//     is detectable deterministically without an LLM call.
const ChannelPassSchema = z
  .object({
    reason: ChannelPassReasonSchema,
    note: z.string().max(280).optional(),
    cited_message_ids: z
      .array(z.string().min(1))
      .max(5)
      .optional()
      .describe(
        'Message ids from <thread-state> that justify this pass. Required when reason is "already_handled" or "duplicate_reply".',
      ),
    quoted_text: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Short verbatim quote from one of the cited messages. Substring-checked against the actual message content.',
      ),
  })
  .refine(
    (value) =>
      !(value.reason === 'already_handled' || value.reason === 'duplicate_reply') ||
      (typeof value.note === 'string' && value.note.trim().length > 0),
    {
      message:
        'channel.pass reason "already_handled" or "duplicate_reply" requires a non-empty note',
      path: ['note'],
    },
  )
  .refine(
    (value) =>
      !(value.reason === 'already_handled' || value.reason === 'duplicate_reply') ||
      (Array.isArray(value.cited_message_ids) && value.cited_message_ids.length > 0),
    {
      message:
        'channel.pass reason "already_handled" or "duplicate_reply" requires cited_message_ids referencing the message(s) that already covered this',
      path: ['cited_message_ids'],
    },
  );

// `channel.handoff` wraps `channel.reply` for explicit sequential
// hand-offs. The tool stamps `[HANDOFF]` (or `[DONE]` when complete)
// into the published content from the server side — the model never
// types the literal token, so we can't accidentally truncate a
// follow-up tool call with a stop sequence (L6).
const ChannelHandoffSchema = z.object({
  to: z.string().min(1),
  reason: z.string().min(1).max(120),
  deliverable: z.string().min(1),
  complete: z.boolean().optional(),
});

function resolveChannelId(
  team: AgentTeamHandle,
  repo: ApiRepository,
  organizationId: string,
  currentMemberId: string,
  channelRef: string,
): string {
  const normalized = channelRef.trim();
  const teamChannel = team.getChannel(normalized);
  if (teamChannel) return teamChannel.id;

  const direct = repo.getChannel(organizationId, normalized);
  if (direct) return direct.id;

  const byName = repo.listAllChannels(organizationId).find((channel) => channel.name === normalized);
  if (byName) return byName.id;

  const member = repo.getMember(organizationId, normalized);
  if (member) {
    return getDirectMessageThreadId(currentMemberId, member.id);
  }

  return normalized;
}

export const channelPostTool: OrchestratorTool<typeof ChannelPostSchema> = {
  id: 'channel.post',
  schema: ChannelPostSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    // Channel ids are not filesystem paths — never pass them as
    // `resourcePath`, or `assertWorkspaceBoundary` will reject `general`,
    // `dm:…`, etc. Channel-scoped policy lives on the IAM matrix instead.
    //
    // `permissionMcpId: 'channels'` groups all channel.* tools under one
    // pseudo-MCP for the IAM matrix. `permissionToolName` is intentionally
    // NOT overridden: the permissions middleware checks `toolName` against
    // `allowed_tools`, which contains the full ids (`channel.post`, …) — a
    // short name like `'post'` would always be rejected before
    // checkToolPolicy runs.
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: ({ invocation, team, repo, conversations }) =>
    conversations.postToChannel({
      organizationId: invocation.organizationId,
      senderId: invocation.memberId,
      channelId: resolveChannelId(
        team,
        repo,
        invocation.organizationId,
        invocation.memberId,
        String(invocation.input.channel_id),
      ),
      body: String(invocation.input.body),
      mentions: Array.isArray(invocation.input.mentions)
        ? invocation.input.mentions.filter((value): value is string => typeof value === 'string')
        : [],
      metadata: { runId: invocation.runId },
    }),
};

export const channelReplyTool: OrchestratorTool<typeof ChannelReplySchema> = {
  id: 'channel.reply',
  schema: ChannelReplySchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    // Message ids are not filesystem paths — see channelPostTool. Same
    // rationale for not overriding permissionToolName.
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: ({ invocation, conversations }) =>
    conversations.replyToMessage({
      organizationId: invocation.organizationId,
      senderId: invocation.memberId,
      messageId: String(invocation.input.message_id),
      body: String(invocation.input.body),
      mentions: Array.isArray(invocation.input.mentions)
        ? invocation.input.mentions.filter((value): value is string => typeof value === 'string')
      : [],
      metadata: { runId: invocation.runId },
    }),
};

export const channelDmTool: OrchestratorTool<typeof ChannelDmSchema> = {
  id: 'channel.dm',
  schema: ChannelDmSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    // See channelPostTool — keep permissionToolName as the full tool id.
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: ({ invocation, conversations }) =>
    conversations.sendDirectMessage({
      organizationId: invocation.organizationId,
      senderId: invocation.memberId,
      recipientId: String(invocation.input.member_id),
      content: String(invocation.input.body),
      ignore: invocation.input.ignore === true,
      mentions: Array.isArray(invocation.input.mentions)
        ? invocation.input.mentions.filter((value): value is string => typeof value === 'string')
        : [],
      metadata: { runId: invocation.runId },
    }),
};

export const channelListTool: OrchestratorTool<typeof ChannelListSchema> = {
  id: 'channel.list',
  schema: ChannelListSchema,
  toInvocation: (args) => ({
    // List is a read; tag the audit row accordingly.
    action: 'read',
    resourceType: 'message',
    // See channelPostTool — keep permissionToolName as the full tool id.
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: ({ invocation, conversations }) =>
    conversations.listVisibleChannels({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      scope: invocation.input.scope === 'all' ? 'all' : 'mine',
    }),
};

export const channelReadTool: OrchestratorTool<typeof ChannelReadSchema> = {
  id: 'channel.read',
  schema: ChannelReadSchema,
  toInvocation: (args) => ({
    // Read is a read; tag the audit row accordingly. Channel ids are not
    // filesystem paths — see channelPostTool. Same rationale for not
    // overriding permissionToolName.
    action: 'read',
    resourceType: 'message',
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: ({ invocation, team, repo, conversations }) =>
    conversations.readChannel({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      channelId: resolveChannelId(
        team,
        repo,
        invocation.organizationId,
        invocation.memberId,
        String(invocation.input.channel_id),
      ),
      since: typeof invocation.input.since === 'string' ? invocation.input.since : undefined,
      query: typeof invocation.input.query === 'string' ? invocation.input.query : undefined,
      cursor: typeof invocation.input.cursor === 'string' ? invocation.input.cursor : undefined,
      limit:
        typeof invocation.input.limit === 'number' ? invocation.input.limit : undefined,
    }),
};

export const selfNoteTool: OrchestratorTool<typeof SelfNoteSchema> = {
  id: 'self.note',
  schema: SelfNoteSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    // Self notes are the agent's private scratchpad. They intentionally bypass
    // policy gating so an agent can always think — EXCEPT when the run was
    // triggered by an @mention. Mandatory-reply enforcement at policy.ts
    // rejects `self.note` for `wakeReason === 'mention'` so the model can't
    // use self.note as an escape hatch (L3). The bypass below skips the
    // permission middleware, but `checkToolPolicy` still runs in the inner
    // ToolServiceImpl, so the mention-reject path catches it.
    bypassPermission: true,
    input: args,
  }),
  execute: ({ invocation, conversations }) =>
    conversations.sendSelfNote({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      body: String(invocation.input.body),
    }),
};

// L1/L12: `channel.pass` is a silent run terminator. It does NOT
// call `publishMessage` — instead it records an audit-only step
// and emits `agent.passed` so the UI can show "Agent X stood down"
// without polluting the channel timeline. The run-loop in
// `run.ts` checks for this tool in `RUN_TERMINATING_TOOL_NAMES`
// and skips the forced-reply path.
export const channelPassTool: OrchestratorTool<typeof ChannelPassSchema> = {
  id: 'channel.pass',
  schema: ChannelPassSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: ({ invocation, repo, conversations }) => {
    const reason = ChannelPassReasonSchema.parse(invocation.input.reason);
    const note =
      typeof invocation.input.note === 'string' ? String(invocation.input.note) : undefined;
    const citedMessageIds = Array.isArray(invocation.input.cited_message_ids)
      ? invocation.input.cited_message_ids.filter(
          (value): value is string => typeof value === 'string',
        )
      : undefined;
    const quotedText =
      typeof invocation.input.quoted_text === 'string'
        ? String(invocation.input.quoted_text)
        : undefined;
    const run = repo.getRun(invocation.organizationId, invocation.runId);
    const threadId = invocation.threadId ?? run?.threadId;
    const channelId = threadId
      ? repo.getThread(invocation.organizationId, threadId)?.channelId
      : undefined;

    // Persist the pass on the run row so metrics queries can find it.
    if (run) {
      repo.saveRun({
        ...run,
        terminatingTool: 'channel.pass',
      });
    }

    // Realtime hook — UI renders this as a collapsed "stood down" affordance.
    void conversations.emitAgentPassed({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      runId: invocation.runId,
      channelId,
      threadId,
      reason,
      note,
    });

    // Shadow-mode verification: compare the claimed reason against
    // thread-state ground truth. Emits a `decision.verification_result`
    // event with verified=bool + structured failureKinds. NO ENFORCEMENT
    // in this phase — we collect data first, then decide which
    // failures justify hard-rejection.
    if (threadId) {
      const agentMember = repo.getMember(invocation.organizationId, invocation.memberId);
      const verificationResult = verifyChannelPass(
        {
          organizationId: invocation.organizationId,
          agentId: invocation.memberId,
          agentName: agentMember?.name,
          threadId,
          reason,
          citedMessageIds,
          quotedText,
          sourceMessageId: run?.sourceMessageId ?? undefined,
        },
        repo,
      );
      void conversations.emitDecisionVerification({
        organizationId: invocation.organizationId,
        memberId: invocation.memberId,
        runId: invocation.runId,
        channelId,
        threadId,
        decision: 'channel.pass',
        claimedReason: reason,
        verified: verificationResult.verified,
        failureKinds: verificationResult.failureKinds,
      });
    }

    return { status: 'passed', reason, note };
  },
};

// L6/L7: `channel.handoff` is the workflow-shaped hand-off
// primitive. It posts a `channel.reply` whose published content is
// suffixed with `[HANDOFF]` or `[DONE]` (when `complete === true`)
// and recorded with `metadata.handoff`. The TOOL appends the
// token, not the model — so we can't accidentally cut off a
// follow-up tool call with a stop sequence.
/**
 * Per-invocation handoff schema. The model's `to:` field is constrained
 * to a Zod enum of real agent ids (and their human-readable names)
 * from the org roster — phantom recipients become structurally
 * impossible at decode time, not after the fact.
 *
 * Falls back to the static `ChannelHandoffSchema` (free-form string)
 * when no repo is available (test fixtures, programmatic callers) or
 * when no valid recipients exist (1-agent org).
 */
function buildHandoffSchemaForOrg(ctx: BuildSchemaContext) {
  const candidates = ctx.repo
    .listMembers(ctx.organizationId)
    .filter((member) => member.kind === AGENT_KIND && !member.retiredAt && member.id !== ctx.memberId);
  // Build the enum from BOTH ids and display names — the model
  // tends to use names (matches the @-mention surface) but legacy
  // callers pass ids. The execute path resolves either.
  const handles = candidates.flatMap((member) => {
    const out = [member.id];
    if (member.name && member.name !== member.id) out.push(member.name);
    return out;
  });
  if (handles.length === 0) {
    return ChannelHandoffSchema;
  }
  return z.object({
    to: z
      .enum(handles as [string, ...string[]])
      .describe('Recipient agent. Pick one of the listed agent ids or display names.'),
    reason: z.string().min(1).max(120),
    deliverable: z.string().min(1),
    complete: z.boolean().optional(),
  });
}

export const channelHandoffTool: OrchestratorTool<typeof ChannelHandoffSchema> = {
  id: 'channel.handoff',
  schema: ChannelHandoffSchema,
  buildSchema: buildHandoffSchemaForOrg,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: ({ invocation, repo, conversations }) => {
    const toMemberId = String(invocation.input.to);
    const reason = String(invocation.input.reason);
    const deliverable = String(invocation.input.deliverable);
    const complete = invocation.input.complete === true;
    const token = complete ? '[DONE]' : '[HANDOFF]';
    const body = `${deliverable}\n\n${token}`;

    const run = repo.getRun(invocation.organizationId, invocation.runId);
    const threadId = invocation.threadId ?? run?.threadId;
    if (!threadId) {
      throw new Error('channel.handoff requires an active thread');
    }

    const thread = repo.getThread(invocation.organizationId, threadId);
    if (!thread) {
      throw new Error(`channel.handoff: thread not found: ${threadId}`);
    }

    // Resolve the recipient name into a member id so we can build the @mention.
    const recipient =
      repo.getMember(invocation.organizationId, toMemberId) ??
      repo
        .listMembers(invocation.organizationId)
        .find((member) => member.name.toLowerCase() === toMemberId.toLowerCase());
    if (!recipient) {
      throw new Error(`channel.handoff: recipient not found: ${toMemberId}`);
    }

    const sender = repo.getMember(invocation.organizationId, invocation.memberId);
    const senderKind = sender?.kind ?? AGENT_KIND;

    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: invocation.organizationId,
      threadId,
      channelId: thread.channelId,
      senderId: invocation.memberId,
      senderKind,
      kind: senderKind,
      content: body,
      mentions: [recipient.id],
      // `runId` mirrors the per-step persistence in spirit.ts and the
      // other terminating channel tools (channel.reply / .post / .dm).
      // Without it, run-detail views can't associate the handoff
      // message with its originating run, so `/runs/:id` shows no
      // visible reply even though the tool posted one.
      metadata: {
        runId: invocation.runId,
        handoff: {
          from: invocation.memberId,
          to: recipient.id,
          reason,
          complete,
        },
      },
      createdAt: new Date().toISOString(),
    });

    const published = conversations.publishMessage(message);

    // Record terminating tool on the run row for metrics.
    if (run) {
      repo.saveRun({
        ...run,
        terminatingTool: 'channel.handoff',
      });
    }

    void conversations.emitAgentHandoff({
      organizationId: invocation.organizationId,
      runId: invocation.runId,
      messageId: published.id,
      channelId: thread.channelId,
      threadId,
      fromMemberId: invocation.memberId,
      toMemberId: recipient.id,
      reason,
      complete,
    });

    // Touch the imported room helpers so an editor doesn't drop them on
    // accidental re-exports. The publish path uses them implicitly via
    // ConversationService.
    void channelRoom;
    void memberRoom;
    void orgRoom;
    void threadRoom;

    return { status: 'handoff_sent', messageId: published.id, complete };
  },
};
