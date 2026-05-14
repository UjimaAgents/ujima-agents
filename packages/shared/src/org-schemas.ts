import { z } from 'zod';
import { GoalStatusSchema } from './goal-schemas.js';

export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

export const TimestampSchema = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

export const PaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function createPaginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
  });
}

export const MemberKindSchema = z.enum(['human', 'agent']);
export type MemberKind = z.infer<typeof MemberKindSchema>;

export const ChannelKindSchema = z.enum(['general', 'group', 'dm', 'task-run', 'self']);
export type ChannelKind = z.infer<typeof ChannelKindSchema>;

export const ToolActionSchema = z.enum(['read', 'write', 'execute', 'mcp', 'message']);
export type ToolAction = z.infer<typeof ToolActionSchema>;

export const ProviderScopeSchema = z.enum(['organization', 'workspace', 'member']);
export type ProviderScope = z.infer<typeof ProviderScopeSchema>;

export const ConfigOwnerSchema = z.enum(['config', 'dashboard']);
export type ConfigOwner = z.infer<typeof ConfigOwnerSchema>;

export const OrgApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type OrgApprovalStatus = z.infer<typeof OrgApprovalStatusSchema>;

export const AuditStatusSchema = z.enum(['ok', 'blocked', 'error']);
export type AuditStatus = z.infer<typeof AuditStatusSchema>;

export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// Task sessions reuse the same status alphabet as runs — a session is the
// parent aggregate over its workers, but its lifecycle states map 1:1
// onto the run vocabulary so dashboards / activity streams don't need a
// second enum.
export const TaskSessionStatusSchema = RunStatusSchema;
export type TaskSessionStatus = z.infer<typeof TaskSessionStatusSchema>;

export const TaskExecutionModeSchema = z.enum(['concurrent', 'slim']);
export type TaskExecutionMode = z.infer<typeof TaskExecutionModeSchema>;

export const MessageKindSchema = z.enum(['human', 'agent', 'system']);
export type MessageKind = z.infer<typeof MessageKindSchema>;

export const MessageMentionKindSchema = z.enum(['mention', 'assignment', 'fyi']);
export type MessageMentionKind = z.infer<typeof MessageMentionKindSchema>;

export const PresenceStateSchema = z.enum(['online', 'offline', 'busy', 'away']);
export type PresenceState = z.infer<typeof PresenceStateSchema>;

export const ResourceTypeSchema = z.enum(['file', 'folder', 'shell', 'mcp', 'message']);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const RoleScopesSchema = z.record(z.array(z.string().min(1))).default({});
export type RoleScopes = z.infer<typeof RoleScopesSchema>;

export const WorkspaceConfigSchema = z.object({
  root: z.string().min(1),
  roleScopes: RoleScopesSchema,
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const OrganizationChartSchema = z.object({
  reportsTo: z.record(IdSchema, IdSchema).default({}),
});
export type OrganizationChart = z.infer<typeof OrganizationChartSchema>;

export const OrganizationSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  workspace: WorkspaceConfigSchema,
  organizationChart: OrganizationChartSchema.default({ reportsTo: {} }),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const MemberSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  name: z.string().min(1),
  kind: MemberKindSchema,
  roleName: z.string().min(1),
  llm: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  presence: PresenceStateSchema.default('offline'),
  createdAt: TimestampSchema.optional(),
  retiredAt: TimestampSchema.optional(),
});
export type Member = z.infer<typeof MemberSchema>;

export const WorkspaceMemberSchema = z.object({
  organizationId: IdSchema,
  memberId: IdSchema,
  roleScopePaths: z.array(z.string().min(1)).default([]),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const AuthUserSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  memberId: IdSchema,
  email: z.string().email(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthSessionSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  organizationId: IdSchema,
  memberId: IdSchema,
  createdAt: TimestampSchema.optional(),
  expiresAt: TimestampSchema,
  lastSeenAt: TimestampSchema.optional(),
  revokedAt: TimestampSchema.optional(),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const ChannelSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema.optional(),
  name: z.string().min(1),
  kind: ChannelKindSchema,
  topic: z.string().default(''),
  memberIds: z.array(IdSchema).default([]),
  parentMessageId: IdSchema.optional(),
  createdAt: TimestampSchema.optional(),
  archivedAt: TimestampSchema.optional(),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const ConfigFieldOwnershipSchema = z.object({
  organizationId: IdSchema,
  entityType: z.enum(['organization', 'role', 'member', 'channel', 'provider']),
  entityId: z.string().min(1),
  fieldName: z.string().min(1),
  owner: ConfigOwnerSchema.default('dashboard'),
  allowDashboardOverride: z.boolean().default(false),
  updatedAt: TimestampSchema.optional(),
});
export type ConfigFieldOwnership = z.infer<typeof ConfigFieldOwnershipSchema>;

export const ConversationThreadSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  channelId: IdSchema.optional(),
  memberIds: z.array(IdSchema).default([]),
  title: z.string().default(''),
  createdAt: TimestampSchema,
});
export type ConversationThread = z.infer<typeof ConversationThreadSchema>;

export const MessageToolCallSchema = z.object({
  toolCallId: IdSchema,
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  result: z.unknown().optional(),
  isError: z.boolean().default(false),
});
export type MessageToolCall = z.infer<typeof MessageToolCallSchema>;

export const AttachmentCategorySchema = z.enum([
  'image',
  'document',
  'audio',
  'video',
  'archive',
  'other',
]);
export type AttachmentCategory = z.infer<typeof AttachmentCategorySchema>;

export const AttachmentSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  category: AttachmentCategorySchema,
  sizeBytes: z.number().int().nonnegative(),
  storagePath: z.string().min(1),
  uploadedBy: IdSchema,
  createdAt: TimestampSchema,
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const MessageAttachmentSchema = z.object({
  messageId: IdSchema,
  attachmentId: IdSchema,
  sortOrder: z.number().int().nonnegative().default(0),
});
export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;

export const MessageMetadataSchema = z.object({
  goalMode: z.boolean().optional(),
}).optional();
export type MessageMetadata = z.infer<typeof MessageMetadataSchema>;

export const MessageSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  threadId: IdSchema,
  channelId: IdSchema.optional(),
  parentMessageId: IdSchema.optional(),
  senderId: IdSchema,
  senderKind: MemberKindSchema,
  kind: MessageKindSchema.default('human'),
  content: z.string(),
  /** Model "thinking" / reasoning from the previous turn; required by some APIs to be echoed back. */
  reasoningContent: z.string().optional(),
  mentions: z.array(IdSchema).default([]),
  mentionNames: z.array(z.string().min(1)).optional(),
  toolCalls: z.array(MessageToolCallSchema).default([]),
  attachments: z.array(AttachmentSchema).default([]),
  metadata: MessageMetadataSchema,
  createdAt: TimestampSchema,
  editedAt: TimestampSchema.optional(),
  deletedAt: TimestampSchema.optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const MessageMentionSchema = z.object({
  id: IdSchema,
  messageId: IdSchema,
  memberId: IdSchema,
  kind: MessageMentionKindSchema.default('mention'),
  createdAt: TimestampSchema.optional(),
});
export type MessageMention = z.infer<typeof MessageMentionSchema>;

export const ProviderBindingSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  apiKeyRef: z.string().min(1).optional(),
  scope: ProviderScopeSchema.default('workspace'),
});
export type ProviderBinding = z.infer<typeof ProviderBindingSchema>;

export const ToolCapabilitySchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  actions: z.array(ToolActionSchema).default([]),
  pathScopes: z.array(z.string().min(1)).default([]),
  requiresApproval: z.boolean().default(true),
});
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

export const ApprovalRequestSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  runId: IdSchema.optional(),
  toolCallId: IdSchema.optional(),
  /** Conversation thread that produced this approval (from the parent run). */
  threadId: IdSchema.optional(),
  requestedBy: IdSchema,
  resourceType: ResourceTypeSchema,
  resourcePath: z.string().min(1),
  action: ToolActionSchema,
  status: OrgApprovalStatusSchema.default('pending'),
  reason: z.string().default(''),
  createdAt: TimestampSchema,
  resolvedAt: TimestampSchema.optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const AuditEventSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  actorId: IdSchema.optional(),
  action: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().min(1).optional(),
  status: AuditStatusSchema.default('ok'),
  createdAt: TimestampSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const RunStateSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  agentId: IdSchema,
  threadId: IdSchema.optional(),
  status: RunStatusSchema,
  step: z.string().default(''),
  summary: z.string().default(''),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
});
export type RunState = z.infer<typeof RunStateSchema>;

export const RunStepSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  runId: IdSchema,
  threadId: IdSchema.optional(),
  agentId: IdSchema,
  toolCallId: IdSchema,
  toolId: z.string().min(1),
  action: ToolActionSchema,
  resourceType: ResourceTypeSchema,
  resourcePath: z.string().default(''),
  input: z.record(z.string(), z.unknown()).default({}),
  output: z.unknown().optional(),
  status: AuditStatusSchema.default('ok'),
  createdAt: TimestampSchema,
});
export type RunStep = z.infer<typeof RunStepSchema>;

// -----------------------------------------------------------------------
// Task session aggregate (Phase 1 of the unified task shell)
// -----------------------------------------------------------------------
//
// A `TaskSession` is the parent record for a piece of work. Each session
// owns:
//   * exactly one `task-run` channel (1:1 with `channel_id`)
//   * a deterministic `slug` (unique within the org)
//   * a team of member ids who actually do the work
//   * an `origin` reference back to the channel/message that prompted
//     the session, when applicable (slash command, promoter decision)
// `RunState` rows become per-agent worker children that link back to a
// session (added in Phase 2 when the worker loop lands).

export const TaskSessionOriginSchema = z.object({
  threadId: IdSchema.optional(),
  channelId: IdSchema.optional(),
  messageId: IdSchema.optional(),
});
export type TaskSessionOrigin = z.infer<typeof TaskSessionOriginSchema>;

export const TaskSessionSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  slug: z.string().min(1),
  channelId: IdSchema,
  requestedBy: IdSchema,
  executionMode: TaskExecutionModeSchema.default('concurrent'),
  status: TaskSessionStatusSchema.default('queued'),
  prompt: z.string().default(''),
  summary: z.string().default(''),
  teamMemberIds: z.array(IdSchema).default([]),
  origin: TaskSessionOriginSchema.default({}),
  promotionMetadata: z.record(z.string(), z.unknown()).default({}),
  supervisorTurnCount: z.number().int().min(0).default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
});
export type TaskSession = z.infer<typeof TaskSessionSchema>;

// -----------------------------------------------------------------------
// Generic message card primitive (Phase 1)
// -----------------------------------------------------------------------
//
// A `MessageCard` is the typed payload that backs every system-message
// affordance: approvals, promotion confirmations, join notices, task
// completion / failure summaries, inline tool-call cards. It rides on
// the existing immutable `messages.tool_calls` JSON column (renamed
// conceptually here — the schema column stays compatible) so we don't
// need a parallel storage path. Concrete card kinds extend the
// discriminated union as features land.

const MessageCardCommon = {
  cardId: IdSchema,
  // Optional run/task linkage so dashboards can navigate from a card to
  // its source aggregate without re-querying.
  runId: IdSchema.optional(),
  taskSessionId: IdSchema.optional(),
};

export const TaskJoinCardSchema = z.object({
  ...MessageCardCommon,
  kind: z.literal('task.join'),
  memberIds: z.array(IdSchema).default([]),
});

export const TaskOriginLinkCardSchema = z.object({
  ...MessageCardCommon,
  kind: z.literal('task.origin-link'),
  taskChannelId: IdSchema,
  taskSlug: z.string().min(1),
});

export const TaskSummaryCardSchema = z.object({
  ...MessageCardCommon,
  kind: z.literal('task.summary'),
  outcome: z.enum(['completed', 'failed', 'cancelled']),
  summary: z.string().default(''),
  taskChannelId: IdSchema.optional(),
  taskSlug: z.string().min(1).optional(),
});

export const GoalArtifactCardSchema = z.object({
  ...MessageCardCommon,
  kind: z.literal('goal.file'),
  goalId: IdSchema,
  goalName: z.string().min(1),
  goalFilePath: z.string().min(1),
  html: z.string(),
  artifactFormat: z.enum(['html', 'markdown']).default('html'),
  status: GoalStatusSchema,
});

export const ApprovalCardSchema = z.object({
  ...MessageCardCommon,
  kind: z.literal('approval'),
  approvalId: IdSchema,
  status: OrgApprovalStatusSchema,
  resourceType: ResourceTypeSchema,
  resourcePath: z.string().min(1),
  action: ToolActionSchema,
  reason: z.string().default(''),
});

export const PromotionConfirmCardSchema = z.object({
  ...MessageCardCommon,
  kind: z.literal('task.promotion-confirm'),
  decision: z.enum(['promote', 'confirm']),
  team: z.array(IdSchema).default([]),
  rationale: z.string().default(''),
});

export const ToolCallCardSchema = z.object({
  ...MessageCardCommon,
  kind: z.literal('tool.call'),
  toolCallId: IdSchema,
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  result: z.unknown().optional(),
  isError: z.boolean().default(false),
});

export const MessageCardSchema = z.discriminatedUnion('kind', [
  TaskJoinCardSchema,
  TaskOriginLinkCardSchema,
  TaskSummaryCardSchema,
  GoalArtifactCardSchema,
  ApprovalCardSchema,
  PromotionConfirmCardSchema,
  ToolCallCardSchema,
]);
export type MessageCard = z.infer<typeof MessageCardSchema>;

export const ToolCallSchema = z.object({
  toolCallId: IdSchema,
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  toolCallId: IdSchema,
  result: z.unknown(),
  isError: z.boolean().default(false),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

// -----------------------------------------------------------------------
// Spirit (Phase 2 of the unified task shell)
// -----------------------------------------------------------------------
//
// A `Spirit` is the per-{task_session_id, member_id, role} runtime
// instance that drives an agent through a task session.
//
//   * role='worker'      — the multi-turn AI SDK loop that owns the work.
//   * role='supervisor'  — the lazy, low-cost DM/@mention answerer. Runs
//                          a single turn on a cheaper-tier model and exits.
//
// Spirit rows are sticky to the (session, member, role) triple: the same
// row is reused across starts/resumes/restarts. Tokens + iteration count
// accumulate; status tracks lifecycle. The "spirit" name is deliberate —
// it's the runtime presence of the agent on a specific task, distinct
// from the persistent `members` row that owns the agent's identity.

export const SpiritRoleSchema = z.enum(['worker', 'supervisor']);
export type SpiritRole = z.infer<typeof SpiritRoleSchema>;

export const SpiritStatusSchema = RunStatusSchema;
export type SpiritStatus = z.infer<typeof SpiritStatusSchema>;

export const SpiritSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  taskSessionId: IdSchema,
  memberId: IdSchema,
  role: SpiritRoleSchema.default('worker'),
  runId: IdSchema.optional(),
  status: SpiritStatusSchema.default('queued'),
  iteration: z.number().int().min(0).default(0),
  tokensUsed: z.number().int().min(0).default(0),
  lastMessageId: IdSchema.optional(),
  lastError: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
});
export type Spirit = z.infer<typeof SpiritSchema>;

// -----------------------------------------------------------------------
// Todo (Phase 2 — supervisor.todo.* tools)
// -----------------------------------------------------------------------
//
// The `todos` table predates the task shell (migration 004), but it only
// becomes user-facing in Phase 2 via the supervisor.todo.* tool family.
// Adding `taskSessionId` lets a supervisor scope its add/check/list to
// the active task without leaking todos across sessions.

export const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TodoSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  taskSessionId: IdSchema.optional(),
  runId: IdSchema.optional(),
  memberId: IdSchema,
  title: z.string().min(1),
  status: TodoStatusSchema.default('pending'),
  notes: z.string().default(''),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Todo = z.infer<typeof TodoSchema>;
