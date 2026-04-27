import { z } from 'zod';

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

export const MessageSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  threadId: IdSchema,
  channelId: IdSchema.optional(),
  parentMessageId: IdSchema.optional(),
  senderId: IdSchema,
  senderKind: MemberKindSchema,
  kind: MessageKindSchema.default('human'),
  content: z.string().min(1),
  mentions: z.array(IdSchema).default([]),
  toolCalls: z.array(MessageToolCallSchema).default([]),
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
