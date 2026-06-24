import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  AGENT_KIND,
  ChannelPassReasonSchema,
  MessageSchema,
  channelRoom,
  getDirectMessageThreadId,
  isDirectMessageThread,
  memberRoom,
  normalizeDmChannelRef,
  orgRoom,
  resolveDmPeerMemberId,
  threadRoom,
} from '@ujima/shared';
import type { BuildSchemaContext } from './types.js';
import type { AgentTeamHandle } from '@ujima/framework';
import type { ApiRepository } from '../services/repository-reader.js';
import { verifyChannelPass } from '../utils/decision-verifier.js';
import type { OrchestratorTool, ToolExecutionContext } from './types.js';
import {
  resolveAttachmentRefs,
  type AttachmentRefInput,
  type ResolvedAttachmentMaterialization,
} from '../services/agent-attachment-resolver.js';
import { createConnectorAuditWriter } from '../services/connector-audit.js';

/**
 * Two-level fallback for the absolute on-disk path of an
 * agent_attachment. storage_path is canonical
 * `agent-generated/<org>/<run>/<id>.<ext>`:
 *   - `attachmentStoreRoot` joins against the full storage_path.
 *   - `agentAttachmentRoot` already includes `agent-generated/`,
 *     so we strip that prefix before joining.
 * Returns null only when neither root is wired (best-effort —
 * the DB row delete still runs in that case).
 */
function resolveAgentAttachmentAbsolutePath(
  ctx: ToolExecutionContext,
  storagePath: string | undefined,
): string | null {
  if (!storagePath) return null;
  if (ctx.attachmentStoreRoot) {
    return join(ctx.attachmentStoreRoot, storagePath);
  }
  if (ctx.agentAttachmentRoot) {
    const stripped = storagePath.startsWith('agent-generated/')
      ? storagePath.slice('agent-generated/'.length)
      : storagePath;
    return join(ctx.agentAttachmentRoot, stripped);
  }
  return null;
}

const AttachmentRefSchema = z.object({
  refType: z
    .enum(['tool_call', 'base64', 'workspace_path', 'workspace_glob'])
    .describe(
      'Where the attachment bytes come from. Use "tool_call" with the ' +
        '`ref` returned by a previous MCP tool result — this is the right ' +
        'choice for Playwright screenshots and most generated images. ' +
        'Use "workspace_path" for a single file already in the workspace, ' +
        '"workspace_glob" for a pattern (max 10 files), and "base64" only ' +
        'for tiny programmatic blobs (1MB cap).',
    ),
  value: z
    .string()
    .min(1)
    .describe(
      'For refType=tool_call: the `ref` string from a tool result ' +
        '`attachment_refs` array, e.g. `tc_<toolCallId>:0`. ' +
        'For workspace_path: a path relative to the workspace root ' +
        '(`screenshots/login.png`, NO `..` segments, NO absolute paths). ' +
        'For workspace_glob: a glob pattern (`screenshots/*.png`). ' +
        'For base64: the raw bytes as a base64 string.',
    ),
  filename: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
});
const ChannelAttachmentsSchema = z
  .array(AttachmentRefSchema)
  .max(10)
  .optional()
  .describe(
    'Optional files to attach to this message. When an MCP tool result ' +
      'contained `attachment_refs`, PREFER refType="tool_call" referencing ' +
      'those refs — that path avoids round-tripping bytes through your ' +
      'context. Max 10 attachments per message.',
  );

const ChannelPostSchema = z.object({
  channel_id: z.string().min(1),
  body: z.string().min(1),
  mentions: z.array(z.string().min(1)).default([]),
  attachments: ChannelAttachmentsSchema,
});

const ChannelReplySchema = z.object({
  message_id: z.string().min(1),
  body: z.string().min(1),
  mentions: z.array(z.string().min(1)).default([]),
  attachments: ChannelAttachmentsSchema,
});

const ChannelDmSchema = z.object({
  member_id: z.string().min(1),
  body: z.string().min(1),
  mentions: z.array(z.string().min(1)).default([]),
  ignore: z.boolean().optional(),
  attachments: ChannelAttachmentsSchema,
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

  const peerMemberId = lookupMemberId(repo, organizationId, normalized);
  if (peerMemberId) {
    return getDirectMessageThreadId(currentMemberId, peerMemberId);
  }

  return normalizeDmChannelRef(normalized, currentMemberId);
}

function lookupMemberId(
  repo: ApiRepository,
  organizationId: string,
  memberRef: string,
): string | undefined {
  const normalized = memberRef.trim();
  const direct = repo.getMember(organizationId, normalized);
  if (direct) return direct.id;
  return repo
    .listMembers(organizationId)
    .find((member) => member.name.toLowerCase() === normalized.toLowerCase())?.id;
}

function resolveMemberId(
  repo: ApiRepository,
  organizationId: string,
  memberRef: string,
): string {
  const memberId = lookupMemberId(repo, organizationId, memberRef);
  if (!memberId) {
    throw new Error(`Member not found: ${memberRef}`);
  }
  return memberId;
}

function rosterMemberHandles(
  ctx: BuildSchemaContext,
  filter: (member: { kind: string; retiredAt?: string | null; id: string }) => boolean,
): string[] {
  return ctx.repo
    .listMembers(ctx.organizationId)
    .filter((member) => filter(member) && !member.retiredAt && member.id !== ctx.memberId)
    .flatMap((member) =>
      member.name && member.name !== member.id ? [member.id, member.name] : [member.id],
    );
}

function rosterAgentHandles(ctx: BuildSchemaContext): string[] {
  return rosterMemberHandles(ctx, (member) => member.kind === AGENT_KIND);
}

function rosterDmHandles(ctx: BuildSchemaContext): string[] {
  return rosterMemberHandles(ctx, () => true);
}

function buildDmSchemaForOrg(ctx: BuildSchemaContext) {
  // In a channel, agents must collaborate in-channel via `@`-mentions —
  // not peel off into private DMs (which hide the work, bury approvals,
  // and burn tokens). Constrain the recipient enum to `self` only so the
  // model can still keep private scratch notes but cannot DM a teammate.
  // DM threads keep the full roster. Mirrors the `channel.handoff`
  // decode-time recipient constraint.
  if (ctx.conversationKind === 'channel') {
    return ChannelDmSchema.extend({
      member_id: z.enum(['self']),
    });
  }
  const handles = rosterDmHandles(ctx);
  if (handles.length === 0) return ChannelDmSchema;
  return ChannelDmSchema.extend({
    member_id: z.enum(handles as [string, ...string[]]),
  });
}

/**
 * Resolve the agent-attachments param into materialised rows for
 * sendMessage. The failure shape is deliberately loud so the model
 * can tell the message wasn't posted and stop retrying the same
 * arguments.
 */
async function resolveAndPinAttachments(
  ctx: ToolExecutionContext,
  attachments: AttachmentRefInput[] | undefined,
  body: string,
): Promise<
  | { ok: true; attachmentIds: string[]; materializations: ResolvedAttachmentMaterialization[] }
  | {
      ok: false;
      status: string;
      message_sent: false;
      error: string;
      recovery: { instruction: string; body_you_tried_to_send: string };
    }
> {
  if (!attachments || attachments.length === 0) {
    return { ok: true, attachmentIds: [], materializations: [] };
  }
  if (!ctx.agentAttachmentRoot) {
    return {
      ok: false,
      status: 'attachments_unavailable',
      message_sent: false,
      error: 'agent-attachments subsystem is not wired in this runtime',
      recovery: {
        instruction:
          'MESSAGE NOT SENT. The agent-attachments subsystem is unavailable in this runtime. ' +
          'Retry channel.reply / channel.post / channel.dm WITHOUT the `attachments` param ' +
          '— just the body — and tell the user the runtime cannot deliver file attachments.',
        body_you_tried_to_send: body,
      },
    };
  }
  const organization = ctx.repo.getOrganization(ctx.invocation.organizationId);
  const workspaceRoot =
    organization?.workspace?.root && typeof organization.workspace.root === 'string'
      ? organization.workspace.root
      : null;
  const audit = createConnectorAuditWriter({ repo: ctx.repo });
  const result = await resolveAttachmentRefs(
    {
      repo: ctx.repo,
      agentAttachmentRoot: ctx.agentAttachmentRoot,
      workspaceRoot,
      organizationId: ctx.invocation.organizationId,
      runId: ctx.invocation.runId,
      memberId: ctx.invocation.memberId,
      audit,
    },
    attachments,
  );
  if (!result.ok) {
    // Surface to the dev log so operators see the cap fire even if
    // they're not staring at the chat. Best-effort — log failures
    // never block the tool result.
    console.warn(
      `[channel-tool] attachments rejected for member=${ctx.invocation.memberId} run=${ctx.invocation.runId}: ${result.error}`,
    );
    return {
      ok: false,
      status: 'attachments_rejected',
      message_sent: false,
      error: result.error,
      recovery: {
        instruction:
          'MESSAGE NOT SENT. Your channel.reply / channel.post / channel.dm call did NOT post to the channel because the attachments param failed validation. ' +
          'Do NOT retry with the same arguments — that will fail the same way. ' +
          'Recovery options: ' +
          '(1) narrow a workspace_glob to match fewer files (max 10), ' +
          '(2) replace the glob with several specific workspace_path refs, one per file, ' +
          '(3) drop the `attachments` param entirely and send the body as a text-only message, then mention the file delivery failure to the user. ' +
          'After choosing one of (1)-(3), issue a NEW channel.reply / channel.post / channel.dm call.',
        body_you_tried_to_send: body,
      },
    };
  }
  return {
    ok: true,
    attachmentIds: result.materializations.map((m) => m.attachmentId),
    materializations: result.materializations,
  };
}

/**
 * After sendMessage / postToChannel / sendDirectMessage has returned
 * a message id, pin the agent_attachments rows to that id so the
 * LRU cleanup job leaves them alone. Best-effort: a pin failure
 * doesn't undo the message — the row just becomes eligible for
 * cleanup if unpinned, which costs a re-attach the next time. Logs
 * a warning.
 */
function pinResolvedAttachments(
  ctx: ToolExecutionContext,
  materializations: ResolvedAttachmentMaterialization[],
  messageId: string,
): void {
  for (const m of materializations) {
    try {
      ctx.repo.pinAgentAttachmentToMessage(
        ctx.invocation.organizationId,
        m.agentAttachmentId,
        messageId,
      );
    } catch (err) {
      console.warn(
        '[channel-tool] failed to pin agent_attachment',
        m.agentAttachmentId,
        err,
      );
    }
  }
}

/**
 * Roll back resolved attachments when the message publish step
 * throws. Only deletes the captured agent_attachments row + file
 * for materializations the resolver OWNS (base64 / workspace_path
 * / workspace_glob). For borrowed tool_call refs, the source row
 * + file belong to the capture pass that produced them — deleting
 * those would destroy the original artifact and break any retry
 * path. The user-attachment row is always our own to delete.
 */
function rollbackResolvedAttachments(
  ctx: ToolExecutionContext,
  materializations: ResolvedAttachmentMaterialization[],
): void {
  const orgId = ctx.invocation.organizationId;
  for (const m of materializations) {
    if (m.ownsAgentAttachmentRow) {
      // Look up the row first so we can resolve the on-disk path
      // before the row is gone. The row delete must always run
      // (DB rows count against quota even when the file is already
      // unlinked); the file unlink is best-effort with two path
      // fallbacks for the case where the store root isn't wired.
      const row = ctx.repo.getAgentAttachment(orgId, m.agentAttachmentId);
      const absolutePath = resolveAgentAttachmentAbsolutePath(ctx, row?.storagePath);
      if (absolutePath) {
        try {
          rmSync(absolutePath, { force: true });
        } catch (err) {
          console.warn(
            '[channel-tool] rollback agent_attachment file unlink failed',
            absolutePath,
            err,
          );
        }
      } else if (row?.storagePath) {
        // Neither attachmentStoreRoot nor agentAttachmentRoot is
        // wired — we can't safely unlink. Log so the file leak is
        // visible; the DB row delete below still runs.
        console.warn(
          '[channel-tool] rollback skipping file unlink (no attachment root wired)',
          row.storagePath,
        );
      }
      try {
        ctx.repo.deleteAgentAttachment(orgId, m.agentAttachmentId);
      } catch (err) {
        console.warn(
          '[channel-tool] rollback agent_attachment row delete failed',
          m.agentAttachmentId,
          err,
        );
      }
    }
    try {
      ctx.repo.deleteAttachment(orgId, m.attachmentId);
    } catch (err) {
      console.warn(
        '[channel-tool] rollback attachments row delete failed',
        m.attachmentId,
        err,
      );
    }
  }
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
  execute: async (ctx) => {
    const { invocation, team, repo, conversations } = ctx;
    const body = String(invocation.input.body);
    const channelId = resolveChannelId(
      team,
      repo,
      invocation.organizationId,
      invocation.memberId,
      String(invocation.input.channel_id),
    );
    const threadId = invocation.threadId ?? channelId;
    const suppressed = conversations.tryMirrorSuppress?.({
      organizationId: invocation.organizationId,
      runId: invocation.runId,
      senderId: invocation.memberId,
      threadId,
      channelId,
      body,
    });
    if (suppressed) {
      return { status: 'mirror_suppressed', terminator: 'channel.ack' };
    }
    const resolveResult = await resolveAndPinAttachments(
      ctx,
      invocation.input.attachments as AttachmentRefInput[] | undefined,
      body,
    );
    if (!resolveResult.ok) {
      return resolveResult;
    }
    let message;
    try {
      message = conversations.postToChannel({
        organizationId: invocation.organizationId,
        senderId: invocation.memberId,
        channelId,
        body,
        mentions: Array.isArray(invocation.input.mentions)
          ? invocation.input.mentions.filter((value): value is string => typeof value === 'string')
          : [],
        attachmentIds: resolveResult.attachmentIds,
        metadata: { runId: invocation.runId },
      });
    } catch (err) {
      rollbackResolvedAttachments(ctx, resolveResult.materializations);
      throw err;
    }
    const messageId =
      message && typeof message === 'object' && 'id' in message
        ? String((message as { id: unknown }).id)
        : null;
    if (messageId) {
      pinResolvedAttachments(ctx, resolveResult.materializations, messageId);
    }
    return message;
  },
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
  execute: async (ctx) => {
    const { invocation, repo, conversations } = ctx;
    const body = String(invocation.input.body);
    const parent = repo.getMessage(
      invocation.organizationId,
      String(invocation.input.message_id),
    );
    const threadId = parent?.threadId ?? invocation.threadId;
    if (threadId) {
      const suppressed = conversations.tryMirrorSuppress?.({
        organizationId: invocation.organizationId,
        runId: invocation.runId,
        senderId: invocation.memberId,
        threadId,
        channelId: parent?.channelId ?? undefined,
        body,
      });
      if (suppressed) {
        return { status: 'mirror_suppressed', terminator: 'channel.ack' };
      }
    }
    const resolveResult = await resolveAndPinAttachments(
      ctx,
      invocation.input.attachments as AttachmentRefInput[] | undefined,
      body,
    );
    if (!resolveResult.ok) {
      return resolveResult;
    }
    let message;
    try {
      message = conversations.replyToMessage({
        organizationId: invocation.organizationId,
        senderId: invocation.memberId,
        messageId: String(invocation.input.message_id),
        body,
        mentions: Array.isArray(invocation.input.mentions)
          ? invocation.input.mentions.filter((value): value is string => typeof value === 'string')
          : [],
        attachmentIds: resolveResult.attachmentIds,
        metadata: { runId: invocation.runId },
      });
    } catch (err) {
      rollbackResolvedAttachments(ctx, resolveResult.materializations);
      throw err;
    }
    const messageId =
      message && typeof message === 'object' && 'id' in message
        ? String((message as { id: unknown }).id)
        : null;
    if (messageId) {
      pinResolvedAttachments(ctx, resolveResult.materializations, messageId);
    }
    return message;
  },
};

export const channelDmTool: OrchestratorTool<typeof ChannelDmSchema> = {
  id: 'channel.dm',
  schema: ChannelDmSchema,
  buildSchema: buildDmSchemaForOrg,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    // See channelPostTool — keep permissionToolName as the full tool id.
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: async (ctx) => {
    const { invocation, repo, conversations } = ctx;
    const body = String(invocation.input.body);
    const recipientRef = String(invocation.input.member_id);
    const recipientId =
      recipientRef === 'self' ? 'self' : resolveMemberId(repo, invocation.organizationId, recipientRef);

    // Defense-in-depth: even though the decode-time schema drops the
    // roster for channel runs (buildDmSchemaForOrg), catch any path that
    // bypasses it (improvised tool calls, supervisor turns, MCP). When
    // the run originates in a channel, agents must not open a private DM
    // to a teammate — they collaborate in-channel via `@`-mentions.
    // Self-notes (`self`) stay allowed everywhere.
    if (recipientId !== 'self' && !isDirectMessageThread(invocation.threadId)) {
      return {
        status: 'dm_blocked_in_channel',
        message_sent: false,
        error:
          'Direct messages to teammates are disabled while working in a channel — this keeps the work visible and avoids siloed side-conversations.',
        recovery: {
          instruction:
            'Post in the channel with channel.post or channel.reply and `@`-mention the teammate instead. Use channel.dm only for private notes to yourself (member_id: "self"), or agent.delegate to hand off a task.',
          body_you_tried_to_send: body,
        },
      };
    }

    const dmThreadId =
      recipientId === 'self'
        ? `self:${invocation.memberId}`
        : getDirectMessageThreadId(invocation.memberId, recipientId);
    const suppressed = conversations.tryMirrorSuppress?.({
      organizationId: invocation.organizationId,
      runId: invocation.runId,
      senderId: invocation.memberId,
      threadId: dmThreadId,
      channelId: dmThreadId,
      body,
    });
    if (suppressed) {
      return { status: 'mirror_suppressed', terminator: 'channel.ack' };
    }
    const resolveResult = await resolveAndPinAttachments(
      ctx,
      invocation.input.attachments as AttachmentRefInput[] | undefined,
      body,
    );
    if (!resolveResult.ok) {
      return resolveResult;
    }
    let message;
    try {
      message = conversations.sendDirectMessage({
        organizationId: invocation.organizationId,
        senderId: invocation.memberId,
        recipientId,
        content: body,
        ignore: invocation.input.ignore === true,
        mentions: Array.isArray(invocation.input.mentions)
          ? invocation.input.mentions.filter((value): value is string => typeof value === 'string')
          : [],
        attachmentIds: resolveResult.attachmentIds,
        metadata: { runId: invocation.runId },
      });
    } catch (err) {
      rollbackResolvedAttachments(ctx, resolveResult.materializations);
      throw err;
    }
    const messageId =
      message && typeof message === 'object' && 'id' in message
        ? String((message as { id: unknown }).id)
        : null;
    if (messageId) {
      pinResolvedAttachments(ctx, resolveResult.materializations, messageId);
    }
    return message;
  },
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
  execute: ({ invocation, conversations }) => {
    const channels = conversations.listVisibleChannels({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      scope: invocation.input.scope === 'all' ? 'all' : 'mine',
    });
    return channels.map((channel) => {
      if (channel.kind !== 'dm') {
        return channel;
      }
      return {
        ...channel,
        dm_thread_id: channel.id,
        dm_peer_member_id: resolveDmPeerMemberId(channel.id, invocation.memberId),
      };
    });
  },
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

    // Post-review enforcement — out_of_scope is no longer a valid
    // silent terminator when the agent was explicitly addressed.
    // Agents were channel.pass'ing with reason: out_of_scope on
    // legitimate questions (e.g. "Layla, what does X do?" where X
    // sits outside the PM role), producing zero visible reply and
    // making the channel feel broken. The model must instead use
    // channel.reply with a one-line redirect.
    if (reason === 'out_of_scope' && run?.sourceMessageId) {
      const source = repo.getMessage(invocation.organizationId, run.sourceMessageId);
      const addressed = (source?.mentions ?? []).includes(invocation.memberId);
      if (addressed) {
        return {
          status: 'rejected' as const,
          error:
            'channel.pass(reason: out_of_scope) is not allowed when you were explicitly addressed. Use channel.reply with a one-line redirect (e.g. "That\'s outside my scope as <role>; @<better-fit> would be a better contact.") instead.',
        };
      }
    }

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

// `channel.ack` — silent terminator for mandatory-reply turns.
//
// When an agent is @mentioned but has nothing substantive to add
// (the prior message is a status update with no question, no new
// information, no decision needed), the model would otherwise be
// forced to emit `channel.reply` with vacuous text — and that text
// would itself re-mention the parent sender, waking them, looping
// the chain. `channel.ack` lets the model satisfy the mandatory-
// reply contract structurally: a terminating tool fired, the run
// closes, the UI shows "Phoebe acknowledged" — and no new wake-
// able channel message is produced.
//
// Unlike `channel.pass` (which requires a structured `reason` and
// shadow-mode verification because it can be misused to opt out of
// real questions), `channel.ack` accepts only an optional brief
// `note` and is allowed even in mandatory-reply mode (palette-
// stripping logic in spirit.ts/ai-service.ts must keep it
// available; `channel.pass` stays stripped).
const ChannelAckSchema = z.object({
  note: z
    .string()
    .max(140)
    .optional()
    .describe(
      'Optional short, private note recorded with the ack — not posted to the channel. Use when you want to leave an audit-trail justification (e.g. "noted, waiting on file from human").',
    ),
});

export const channelAckTool: OrchestratorTool<typeof ChannelAckSchema> = {
  id: 'channel.ack',
  schema: ChannelAckSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: ({ invocation, repo, conversations }) => {
    const note =
      typeof invocation.input.note === 'string' && invocation.input.note.trim().length > 0
        ? invocation.input.note.trim()
        : undefined;
    const run = repo.getRun(invocation.organizationId, invocation.runId);
    const threadId = invocation.threadId ?? run?.threadId;
    const channelId = threadId
      ? repo.getThread(invocation.organizationId, threadId)?.channelId
      : undefined;

    if (run) {
      repo.saveRun({
        ...run,
        terminatingTool: 'channel.ack',
      });
    }

    void conversations.emitAgentAck({
      organizationId: invocation.organizationId,
      memberId: invocation.memberId,
      runId: invocation.runId,
      channelId,
      threadId,
      note,
    });

    return { status: 'acked', note };
  },
};

// L6/L7: `channel.handoff` is the workflow-shaped hand-off
// primitive. It posts a `channel.reply` whose published content is
// suffixed with `[HANDOFF]` or `[DONE]` (when `complete === true`)
// and recorded with `metadata.handoff`. The TOOL appends the
// token, not the model — so we can't accidentally cut off a
// follow-up tool call with a stop sequence.
function buildHandoffSchemaForOrg(ctx: BuildSchemaContext) {
  const handles = rosterAgentHandles(ctx);
  if (handles.length === 0) {
    return ChannelHandoffSchema;
  }
  return ChannelHandoffSchema.extend({
    to: z.enum(handles as [string, ...string[]]),
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
    const toRef = String(invocation.input.to);
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

    const recipientId = resolveMemberId(repo, invocation.organizationId, toRef);

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
      mentions: [recipientId],
      // `runId` mirrors the per-step persistence in spirit.ts and the
      // other terminating channel tools (channel.reply / .post / .dm).
      // Without it, run-detail views can't associate the handoff
      // message with its originating run, so `/runs/:id` shows no
      // visible reply even though the tool posted one.
      metadata: {
        runId: invocation.runId,
        handoff: {
          from: invocation.memberId,
          to: recipientId,
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
      toMemberId: recipientId,
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

// -----------------------------------------------------------------------
// Channel member mode management
// -----------------------------------------------------------------------

const ChannelSetMemberModeSchema = z.object({
  channel_id: z.string().min(1),
  member_id: z.string().min(1),
  mode: z.enum(['active', 'passive', 'muted', 'temp_disable']),
});

export const channelSetMemberModeTool: OrchestratorTool<typeof ChannelSetMemberModeSchema> = {
  id: 'channel.set_member_mode',
  schema: ChannelSetMemberModeSchema,
  toInvocation: (args) => ({
    action: 'write',
    resourceType: 'message',
    permissionMcpId: 'channels',
    input: args,
  }),
  execute: ({ invocation, repo }) => {
    const channelId = String(invocation.input.channel_id);
    const memberId = String(invocation.input.member_id);
    const mode = String(invocation.input.mode) as 'active' | 'passive' | 'muted' | 'temp_disable';

    const channel = repo.getChannel(invocation.organizationId, channelId);
    if (!channel) {
      return { status: 'error', error: `Channel not found: ${channelId}` };
    }

    const member = repo.getMember(invocation.organizationId, memberId);
    if (!member) {
      return { status: 'error', error: `Member not found: ${memberId}` };
    }

    repo.setChannelMemberMode(invocation.organizationId, channelId, memberId, mode);

    return {
      status: 'ok',
      channelId,
      memberId,
      mode,
    };
  },
};
