import { z } from "zod";
export const IdSchema = z.string().min(1);
export const TimestampSchema = z.string().datetime({ offset: true });
export const MemberKindSchema = z.enum(["human", "agent"]);
export const ChannelKindSchema = z.enum(["general", "group", "dm"]);
export const ToolActionSchema = z.enum(["read", "write", "execute", "git", "mcp"]);
export const ProviderScopeSchema = z.enum(["organization", "workspace", "member"]);
export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export const AuditStatusSchema = z.enum(["ok", "blocked", "error"]);
export const RunStatusSchema = z.enum([
    "queued",
    "running",
    "waiting_for_approval",
    "completed",
    "failed",
    "cancelled",
]);
export const MessageKindSchema = z.enum(["human", "agent", "system"]);
export const PresenceStateSchema = z.enum(["online", "offline", "busy", "away"]);
export const ResourceTypeSchema = z.enum(["file", "folder", "shell", "git", "mcp"]);
export const RoleScopesSchema = z.record(z.array(z.string().min(1))).default({});
export const WorkspaceConfigSchema = z.object({
    root: z.string().min(1),
    roleScopes: RoleScopesSchema,
});
export const OrganizationSchema = z.object({
    id: IdSchema,
    name: z.string().min(1),
    workspace: WorkspaceConfigSchema,
});
export const MemberSchema = z.object({
    id: IdSchema,
    organizationId: IdSchema,
    name: z.string().min(1),
    kind: MemberKindSchema,
    roleName: z.string().min(1),
    presence: PresenceStateSchema.default("offline"),
});
export const ChannelSchema = z.object({
    id: IdSchema,
    organizationId: IdSchema.optional(),
    name: z.string().min(1),
    kind: ChannelKindSchema,
    topic: z.string().default(""),
    memberIds: z.array(IdSchema).default([]),
});
export const ConversationThreadSchema = z.object({
    id: IdSchema,
    organizationId: IdSchema,
    channelId: IdSchema.optional(),
    memberIds: z.array(IdSchema).default([]),
    title: z.string().default(""),
    createdAt: TimestampSchema,
});
export const MessageSchema = z.object({
    id: IdSchema,
    organizationId: IdSchema,
    threadId: IdSchema,
    channelId: IdSchema.optional(),
    senderId: IdSchema,
    senderKind: MemberKindSchema,
    kind: MessageKindSchema.default("human"),
    content: z.string().min(1),
    mentions: z.array(IdSchema).default([]),
    createdAt: TimestampSchema,
});
export const ProviderBindingSchema = z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    apiKeyRef: z.string().min(1).optional(),
    scope: ProviderScopeSchema.default("workspace"),
});
export const ToolCapabilitySchema = z.object({
    id: IdSchema,
    name: z.string().min(1),
    description: z.string().default(""),
    actions: z.array(ToolActionSchema).default([]),
    pathScopes: z.array(z.string().min(1)).default([]),
    requiresApproval: z.boolean().default(true),
});
export const ApprovalRequestSchema = z.object({
    id: IdSchema,
    organizationId: IdSchema,
    runId: IdSchema.optional(),
    requestedBy: IdSchema,
    resourceType: ResourceTypeSchema,
    resourcePath: z.string().min(1),
    action: ToolActionSchema,
    status: ApprovalStatusSchema.default("pending"),
    reason: z.string().default(""),
    createdAt: TimestampSchema,
    resolvedAt: TimestampSchema.optional(),
});
export const AuditEventSchema = z.object({
    id: IdSchema,
    organizationId: IdSchema,
    actorId: IdSchema.optional(),
    action: z.string().min(1),
    targetType: z.string().min(1),
    targetId: z.string().min(1).optional(),
    status: AuditStatusSchema.default("ok"),
    createdAt: TimestampSchema,
    metadata: z.record(z.string(), z.unknown()).default({}),
});
export const RunStateSchema = z.object({
    id: IdSchema,
    organizationId: IdSchema,
    agentId: IdSchema,
    threadId: IdSchema.optional(),
    status: RunStatusSchema,
    step: z.string().default(""),
    summary: z.string().default(""),
    startedAt: TimestampSchema,
    endedAt: TimestampSchema.optional(),
});
