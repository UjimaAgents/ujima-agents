import { z } from 'zod';
import { MemberShellApprovalModeSchema } from './shell-approval.js';
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

export const ToolActionSchema = z.enum(['read', 'write', 'execute', 'mcp', 'message', 'create', 'update']);
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
  'waiting_for_input',
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

export const ResourceTypeSchema = z.enum(['file', 'folder', 'shell', 'mcp', 'message', 'goal', 'goal_task', 'question']);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const RoleScopesSchema = z.record(z.array(z.string().min(1))).default({});
export type RoleScopes = z.infer<typeof RoleScopesSchema>;

export const WorkspaceConfigSchema = z.object({
  /** Empty until onboarding or workspace activation sets a path. */
  root: z.string().default(''),
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
  shellApprovalMode: MemberShellApprovalModeSchema.optional(),
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

export const HandoffMetadataSchema = z.object({
  from: IdSchema,
  to: IdSchema,
  reason: z.string().min(1).max(120),
  complete: z.boolean().default(false),
});
export type HandoffMetadata = z.infer<typeof HandoffMetadataSchema>;

export const MessageMetadataSchema = z.object({
  goalMode: z.boolean().optional(),
  /**
   * Set by the `channel.handoff` tool. `complete: true` signals
   * the chain terminated (replaces the old `'Acknowledged.'`
   * literal termination protocol).
   */
  handoff: HandoffMetadataSchema.optional(),
  /** Correlates persisted agent replies with in-flight `run:chunk` streaming bubbles. */
  runId: IdSchema.optional(),
  failedTrace: z.boolean().optional(),
  stoppedTrace: z.boolean().optional(),
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
  /**
   * L10 — client-supplied idempotency key. Optional. When present
   * the daemon dedupes against the (org, sender, thread, clientMessageId)
   * tuple so retried POSTs are no-ops.
   */
  clientMessageId: IdSchema.optional(),
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
  // Why this run was created. Drives mandatory-reply enforcement and
  // observability. `mention` runs cannot terminate via `channel.pass`
  // (policy rejects it). Persisted as a string so a
  // future enum value doesn't break the schema parser on old rows.
  wakeReason: z.string().nullable().optional(),
  // The terminating tool the run ended with. One of the entries in
  // RUN_TERMINATING_TOOL_NAMES, or `null` when the run ended via the
  // free-text reply path. Useful for metrics: count runs by
  // terminatingTool x wakeReason to compute pass-rate / reply-rate.
  terminatingTool: z.string().nullable().optional(),
  // The message id that triggered this wake. Optional because programmatic
  // run creation (task-sessions, debugging) need not carry one.
  sourceMessageId: z.string().nullable().optional(),
  // Who triggered the wake (the human or agent who tagged this agent).
  // Required for accurate attribution on `member.must_reply_failed` —
  // without it, the failure event always points back at the agent
  // itself, which makes triage useless.
  byMemberId: z.string().nullable().optional(),
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

export const ArtifactFileCardSchema = z.object({
  ...MessageCardCommon,
  kind: z.literal('artifact.file'),
  artifactId: IdSchema,
  name: z.string().min(1),
  filePath: z.string().min(1),
  html: z.string(),
  diff: z.string().optional(),
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
  ArtifactFileCardSchema,
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
// Memory KV — Bet 5
//
// Activates the dormant `memory_entries` table as a per-(org, member)
// key-value store. `kind` tags the type of memory; `key` is the
// lookup; `content` (existing column) is the value; `expiresAt`
// gives the entry a TTL; `lastRecalledAt` is updated on read so
// frequently-recalled facts stay hot when surfaced into the wake
// prompt. Designed flat — if cross-fact relations become a product
// need we promote additively to SPO triples, not retroactively.
// -----------------------------------------------------------------------

export const MemoryEntryKindSchema = z.enum([
  'fact',
  'preference',
  'identity',
  'rule',
]);
export type MemoryEntryKind = z.infer<typeof MemoryEntryKindSchema>;

export const MemoryEntrySchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  memberId: IdSchema.optional(),
  kind: MemoryEntryKindSchema,
  key: z.string().min(1).max(120),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  expiresAt: TimestampSchema.optional(),
  sourceMessageId: IdSchema.optional(),
  lastRecalledAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

// -----------------------------------------------------------------------
// Workspace File index — Bet 4
//
// Backs `workspace_files_fts` (FTS5 cannot index a filesystem
// directly). Populated by the `write` / `edit` / `multiedit` tool
// hooks; queried by `channel.recall` for cross-channel artifact
// recall. Size capped per-file at the hook layer (default 100KB) so
// the table doesn't grow unbounded against large binaries; total
// per-org size is also bounded by an eviction sweep that drops the
// oldest rows when the per-org footprint exceeds the configured cap.
// -----------------------------------------------------------------------

export const WorkspaceFileSchema = z.object({
  organizationId: IdSchema,
  path: z.string().min(1),
  body: z.string(),
  writtenBy: IdSchema,
  channelId: IdSchema.optional(),
  sizeBytes: z.number().int().nonnegative(),
  updatedAt: TimestampSchema,
});
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

// -----------------------------------------------------------------------
// Decision log — Bet 6
//
// Append-only record of channel decisions, harvested from messages
// by the same regex pattern the existing compaction extractor uses
// at conversation-summary.ts:216. Survives L1 compaction so the
// load-bearing "we decided X" lines can never be lost to summariser
// drift. `supersedesId` lets a later decision shadow an earlier one
// without delete.
// -----------------------------------------------------------------------

export const DecisionLogEntrySchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  channelId: IdSchema,
  decidedAt: TimestampSchema,
  decidedBy: IdSchema,
  decisionText: z.string().min(1),
  sourceMessageId: IdSchema,
  supersedesId: IdSchema.optional(),
  createdAt: TimestampSchema,
});
export type DecisionLogEntry = z.infer<typeof DecisionLogEntrySchema>;

// -----------------------------------------------------------------------
// Procedures as Culture (docs/procedures-as-culture.md)
// -----------------------------------------------------------------------

export const ProcedureScopeSchema = z.enum(['org', 'channel', 'agent']);
export type ProcedureScope = z.infer<typeof ProcedureScopeSchema>;

/** Append-only version history. One row per save. */
export const ProcedureRevisionSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  scope: ProcedureScopeSchema,
  scopeId: z.string(), // '' for org; channel-id; agent-id
  name: z.string().min(1).max(64),
  version: z.number().int().min(1),
  bodySnapshot: z.string(),
  description: z.string(),
  enforced: z.boolean().default(false),
  updatedBy: IdSchema,
  updatedAt: TimestampSchema,
});
export type ProcedureRevision = z.infer<typeof ProcedureRevisionSchema>;

/** Captures what was surfaced into a given wake's system prompt. */
export const RunProcedureAppliedSchema = z.object({
  organizationId: IdSchema,
  runId: IdSchema,
  scope: ProcedureScopeSchema,
  scopeId: z.string(),
  name: z.string().min(1).max(64),
  version: z.number().int().min(1),
  enforced: z.boolean().default(false),
  createdAt: TimestampSchema,
});
export type RunProcedureApplied = z.infer<typeof RunProcedureAppliedSchema>;

// -----------------------------------------------------------------------
// Scheduled Jobs (cron)
// -----------------------------------------------------------------------

export const CronExpressionSchema = z.string().min(1).regex(
  /^(\S+\s+){4}\S+$/,
  'Must be a valid 5-field cron expression (min hour dom mon dow)',
);
export type CronExpression = z.infer<typeof CronExpressionSchema>;

export const JobStatusSchema = z.enum(['active', 'paused', 'completed', 'failed']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const ScheduledJobSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  name: z.string().min(1),
  cronExpression: CronExpressionSchema,
  prompt: z.string().min(1),
  channelId: IdSchema.optional(),
  memberId: IdSchema,
  status: JobStatusSchema.default('active'),
  lastRunAt: TimestampSchema.optional(),
  nextRunAt: TimestampSchema.optional(),
  runCount: z.number().int().min(0).default(0),
  lastError: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;

export const CreateScheduledJobInputSchema = z.object({
  name: z.string().min(1),
  cronExpression: CronExpressionSchema,
  prompt: z.string().min(1),
  channelId: IdSchema.optional(),
});
export type CreateScheduledJobInput = z.infer<typeof CreateScheduledJobInputSchema>;

export const UpdateScheduledJobInputSchema = z.object({
  name: z.string().min(1).optional(),
  cronExpression: CronExpressionSchema.optional(),
  prompt: z.string().min(1).optional(),
  channelId: IdSchema.optional(),
  status: JobStatusSchema.optional(),
});
export type UpdateScheduledJobInput = z.infer<typeof UpdateScheduledJobInputSchema>;

// -----------------------------------------------------------------------
// MCP Registry (Phase 3 — agent-owned MCP access)
// -----------------------------------------------------------------------
//
// A `McpServer` is the canonical record for an MCP endpoint an org has
// registered. Secrets — stdio env vars, remote auth headers — are stored
// out-of-band via `*_key_ref` pointers into the file-backed secret
// store. They never appear inline in DB rows, API responses, audit
// rows, or realtime events.
//
// `AgentMcpAttachment` is the access grant: which agent can call which
// MCP, and at which spirit-role scope. Worker spirits inherit
// `scope='worker'|'both'` MCPs; supervisor spirits only inherit
// `scope='supervisor'|'both'` MCPs. The default `'worker'` matches
// the architecture rule: supervisors never automatically inherit
// worker MCPs.

export const McpTransportSchema = z.enum(['stdio', 'sse', 'http-streamable']);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpIsolationSchema = z.enum(['shared', 'per-agent']);
export type McpIsolation = z.infer<typeof McpIsolationSchema>;

export const McpServerStatusSchema = z.enum(['active', 'disabled', 'error']);
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

export const McpAttachmentScopeSchema = z.enum(['worker', 'supervisor', 'both']);
export type McpAttachmentScope = z.infer<typeof McpAttachmentScopeSchema>;

/**
 * Canonical MCP server row. Secrets ride as `*_key_ref` only;
 * `envKeyRef` is the secret-store pointer to the JSON-encoded env-var
 * map for stdio servers, `headersKeyRef` is the same for HTTP/SSE
 * auth headers. The REST surface emits a redacted shape (see
 * `McpServerPublicSchema`).
 */
export const McpServerSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  category: z.string().default('general'),
  transport: McpTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  envKeyRef: z.string().min(1).optional(),
  url: z.string().optional(),
  headersKeyRef: z.string().min(1).optional(),
  isolation: McpIsolationSchema.default('shared'),
  status: McpServerStatusSchema.default('active'),
  lastTestedAt: TimestampSchema.optional(),
  lastTestError: z.string().optional(),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type McpServer = z.infer<typeof McpServerSchema>;

/**
 * Redacted MCP server shape returned over the REST API. Drops every
 * `*_key_ref` (those are internal secret-store pointers, not data the
 * caller should see) and surfaces `hasEnv` / `hasHeaders` booleans so
 * the UI can render "configured" indicators without ever touching
 * secret material. `secretKeys` is a list of the named keys present
 * (useful for the settings form) — names only, no values.
 */
export const McpServerPublicSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  name: z.string(),
  description: z.string(),
  category: z.string(),
  transport: McpTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()),
  url: z.string().optional(),
  isolation: McpIsolationSchema,
  status: McpServerStatusSchema,
  hasEnv: z.boolean(),
  hasHeaders: z.boolean(),
  envKeys: z.array(z.string()),
  headerKeys: z.array(z.string()),
  lastTestedAt: TimestampSchema.optional(),
  lastTestError: z.string().optional(),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type McpServerPublic = z.infer<typeof McpServerPublicSchema>;

export const AgentMcpAttachmentSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  memberId: IdSchema,
  mcpServerId: IdSchema,
  scope: McpAttachmentScopeSchema.default('worker'),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type AgentMcpAttachment = z.infer<typeof AgentMcpAttachmentSchema>;

/**
 * Tool entry as stored in the cache. Mirrors what MCP's `listTools`
 * returns. `destructive` is optional metadata the policy layer reads
 * to decide whether a tool needs explicit approval beyond the default.
 */
export const McpToolDescriptorSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  destructive: z.boolean().optional(),
});
export type McpToolDescriptor = z.infer<typeof McpToolDescriptorSchema>;

export const McpToolCacheSchema = z.object({
  mcpServerId: IdSchema,
  organizationId: IdSchema,
  tools: z.array(McpToolDescriptorSchema).default([]),
  fetchedAt: TimestampSchema,
  error: z.string().optional(),
});
export type McpToolCache = z.infer<typeof McpToolCacheSchema>;

export const PluginSkillManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  userInvocable: z.boolean().default(false),
  disableModelInvocation: z.boolean().default(false),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string()).default({}),
});
export type PluginSkillManifest = z.infer<typeof PluginSkillManifestSchema>;

export const PluginManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  version: z.string().default('0.0.0'),
  author: z.string().optional(),
  skills: z.array(PluginSkillManifestSchema).default([]),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const PluginInstallSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  pluginId: z.string().min(1),
  pluginName: z.string().min(1),
  version: z.string().min(1),
  sourceUrl: z.string().min(1),
  localPath: z.string().min(1),
  status: z.enum(['installed', 'error']).default('installed'),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type PluginInstall = z.infer<typeof PluginInstallSchema>;

export const SkillInstallSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  pluginInstallId: IdSchema,
  pluginId: z.string().min(1),
  pluginName: z.string().min(1),
  skillName: z.string().min(1),
  commandName: z.string().min(1),
  description: z.string().default(''),
  userInvocable: z.boolean().default(false),
  disableModelInvocation: z.boolean().default(false),
  skillPath: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type SkillInstall = z.infer<typeof SkillInstallSchema>;
