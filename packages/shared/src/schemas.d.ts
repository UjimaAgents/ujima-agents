import { z } from "zod";
export declare const IdSchema: z.ZodString;
export type Id = z.infer<typeof IdSchema>;
export declare const TimestampSchema: z.ZodString;
export type Timestamp = z.infer<typeof TimestampSchema>;
export declare const MemberKindSchema: z.ZodEnum<["human", "agent"]>;
export type MemberKind = z.infer<typeof MemberKindSchema>;
export declare const ChannelKindSchema: z.ZodEnum<["general", "group", "dm"]>;
export type ChannelKind = z.infer<typeof ChannelKindSchema>;
export declare const ToolActionSchema: z.ZodEnum<["read", "write", "execute", "mcp", "message"]>;
export type ToolAction = z.infer<typeof ToolActionSchema>;
export declare const ProviderScopeSchema: z.ZodEnum<["organization", "workspace", "member"]>;
export type ProviderScope = z.infer<typeof ProviderScopeSchema>;
export declare const ApprovalStatusSchema: z.ZodEnum<["pending", "approved", "rejected"]>;
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;
export declare const AuditStatusSchema: z.ZodEnum<["ok", "blocked", "error"]>;
export type AuditStatus = z.infer<typeof AuditStatusSchema>;
export declare const RunStatusSchema: z.ZodEnum<["queued", "running", "waiting_for_approval", "completed", "failed", "cancelled"]>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export declare const MessageKindSchema: z.ZodEnum<["human", "agent", "system"]>;
export type MessageKind = z.infer<typeof MessageKindSchema>;
export declare const PresenceStateSchema: z.ZodEnum<["online", "offline", "busy", "away"]>;
export type PresenceState = z.infer<typeof PresenceStateSchema>;
export declare const ResourceTypeSchema: z.ZodEnum<["file", "folder", "shell", "mcp", "message"]>;
export type ResourceType = z.infer<typeof ResourceTypeSchema>;
export declare const RoleScopesSchema: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>>;
export type RoleScopes = z.infer<typeof RoleScopesSchema>;
export declare const WorkspaceConfigSchema: z.ZodObject<{
    root: z.ZodString;
    roleScopes: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
    root: string;
    roleScopes: Record<string, string[]>;
}, {
    root: string;
    roleScopes?: Record<string, string[]> | undefined;
}>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export declare const OrganizationChartSchema: z.ZodObject<{
    reportsTo: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    reportsTo: Record<string, string>;
}, {
    reportsTo?: Record<string, string> | undefined;
}>;
export type OrganizationChart = z.infer<typeof OrganizationChartSchema>;
export declare const OrganizationSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    workspace: z.ZodObject<{
        root: z.ZodString;
        roleScopes: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>>;
    }, "strip", z.ZodTypeAny, {
        root: string;
        roleScopes: Record<string, string[]>;
    }, {
        root: string;
        roleScopes?: Record<string, string[]> | undefined;
    }>;
    organizationChart: z.ZodDefault<z.ZodObject<{
        reportsTo: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        reportsTo: Record<string, string>;
    }, {
        reportsTo?: Record<string, string> | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    workspace: {
        root: string;
        roleScopes: Record<string, string[]>;
    };
    organizationChart: {
        reportsTo: Record<string, string>;
    };
}, {
    id: string;
    name: string;
    workspace: {
        root: string;
        roleScopes?: Record<string, string[]> | undefined;
    };
    organizationChart?: {
        reportsTo?: Record<string, string> | undefined;
    } | undefined;
}>;
export type Organization = z.infer<typeof OrganizationSchema>;
export declare const MemberSchema: z.ZodObject<{
    id: z.ZodString;
    organizationId: z.ZodString;
    name: z.ZodString;
    kind: z.ZodEnum<["human", "agent"]>;
    roleName: z.ZodString;
    presence: z.ZodDefault<z.ZodEnum<["online", "offline", "busy", "away"]>>;
    createdAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    kind: "human" | "agent";
    organizationId: string;
    roleName: string;
    presence: "online" | "offline" | "busy" | "away";
    createdAt?: string | undefined;
}, {
    id: string;
    name: string;
    kind: "human" | "agent";
    organizationId: string;
    roleName: string;
    presence?: "online" | "offline" | "busy" | "away" | undefined;
    createdAt?: string | undefined;
}>;
export type Member = z.infer<typeof MemberSchema>;
export declare const ChannelSchema: z.ZodObject<{
    id: z.ZodString;
    organizationId: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    kind: z.ZodEnum<["general", "group", "dm"]>;
    topic: z.ZodDefault<z.ZodString>;
    memberIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    id: string;
    topic: string;
    name: string;
    kind: "general" | "group" | "dm";
    memberIds: string[];
    organizationId?: string | undefined;
}, {
    id: string;
    name: string;
    kind: "general" | "group" | "dm";
    topic?: string | undefined;
    memberIds?: string[] | undefined;
    organizationId?: string | undefined;
}>;
export type Channel = z.infer<typeof ChannelSchema>;
export declare const ConversationThreadSchema: z.ZodObject<{
    id: z.ZodString;
    organizationId: z.ZodString;
    channelId: z.ZodOptional<z.ZodString>;
    memberIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    title: z.ZodDefault<z.ZodString>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    memberIds: string[];
    organizationId: string;
    title: string;
    createdAt: string;
    channelId?: string | undefined;
}, {
    id: string;
    organizationId: string;
    createdAt: string;
    memberIds?: string[] | undefined;
    channelId?: string | undefined;
    title?: string | undefined;
}>;
export type ConversationThread = z.infer<typeof ConversationThreadSchema>;
export declare const MessageSchema: z.ZodObject<{
    id: z.ZodString;
    organizationId: z.ZodString;
    threadId: z.ZodString;
    channelId: z.ZodOptional<z.ZodString>;
    senderId: z.ZodString;
    senderKind: z.ZodEnum<["human", "agent"]>;
    kind: z.ZodDefault<z.ZodEnum<["human", "agent", "system"]>>;
    content: z.ZodString;
    mentions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    kind: "human" | "agent" | "system";
    organizationId: string;
    createdAt: string;
    threadId: string;
    senderId: string;
    senderKind: "human" | "agent";
    content: string;
    mentions: string[];
    channelId?: string | undefined;
}, {
    id: string;
    organizationId: string;
    createdAt: string;
    threadId: string;
    senderId: string;
    senderKind: "human" | "agent";
    content: string;
    kind?: "human" | "agent" | "system" | undefined;
    channelId?: string | undefined;
    mentions?: string[] | undefined;
}>;
export type Message = z.infer<typeof MessageSchema>;
export declare const ProviderBindingSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    apiKeyRef: z.ZodOptional<z.ZodString>;
    scope: z.ZodDefault<z.ZodEnum<["organization", "workspace", "member"]>>;
}, "strip", z.ZodTypeAny, {
    provider: string;
    model: string;
    scope: "organization" | "workspace" | "member";
    apiKeyRef?: string | undefined;
}, {
    provider: string;
    model: string;
    apiKeyRef?: string | undefined;
    scope?: "organization" | "workspace" | "member" | undefined;
}>;
export type ProviderBinding = z.infer<typeof ProviderBindingSchema>;
export declare const ToolCapabilitySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    actions: z.ZodDefault<z.ZodArray<z.ZodEnum<["read", "write", "execute", "mcp", "message"]>, "many">>;
    pathScopes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    requiresApproval: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    description: string;
    actions: ("read" | "write" | "execute" | "mcp" | "message")[];
    pathScopes: string[];
    requiresApproval: boolean;
}, {
    id: string;
    name: string;
    description?: string | undefined;
    actions?: ("read" | "write" | "execute" | "mcp" | "message")[] | undefined;
    pathScopes?: string[] | undefined;
    requiresApproval?: boolean | undefined;
}>;
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;
export declare const ApprovalRequestSchema: z.ZodObject<{
    id: z.ZodString;
    organizationId: z.ZodString;
    runId: z.ZodOptional<z.ZodString>;
    requestedBy: z.ZodString;
    resourceType: z.ZodEnum<["file", "folder", "shell", "mcp", "message"]>;
    resourcePath: z.ZodString;
    action: z.ZodEnum<["read", "write", "execute", "mcp", "message"]>;
    status: z.ZodDefault<z.ZodEnum<["pending", "approved", "rejected"]>>;
    reason: z.ZodDefault<z.ZodString>;
    createdAt: z.ZodString;
    resolvedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "pending" | "approved" | "rejected";
    organizationId: string;
    createdAt: string;
    requestedBy: string;
    resourceType: "mcp" | "message" | "file" | "folder" | "shell";
    resourcePath: string;
    action: "read" | "write" | "execute" | "mcp" | "message";
    reason: string;
    runId?: string | undefined;
    resolvedAt?: string | undefined;
}, {
    id: string;
    organizationId: string;
    createdAt: string;
    requestedBy: string;
    resourceType: "mcp" | "message" | "file" | "folder" | "shell";
    resourcePath: string;
    action: "read" | "write" | "execute" | "mcp" | "message";
    status?: "pending" | "approved" | "rejected" | undefined;
    runId?: string | undefined;
    reason?: string | undefined;
    resolvedAt?: string | undefined;
}>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export declare const AuditEventSchema: z.ZodObject<{
    id: z.ZodString;
    organizationId: z.ZodString;
    actorId: z.ZodOptional<z.ZodString>;
    action: z.ZodString;
    targetType: z.ZodString;
    targetId: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["ok", "blocked", "error"]>>;
    createdAt: z.ZodString;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "ok" | "blocked" | "error";
    organizationId: string;
    createdAt: string;
    action: string;
    targetType: string;
    metadata: Record<string, unknown>;
    actorId?: string | undefined;
    targetId?: string | undefined;
}, {
    id: string;
    organizationId: string;
    createdAt: string;
    action: string;
    targetType: string;
    status?: "ok" | "blocked" | "error" | undefined;
    actorId?: string | undefined;
    targetId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export declare const RunStateSchema: z.ZodObject<{
    id: z.ZodString;
    organizationId: z.ZodString;
    agentId: z.ZodString;
    threadId: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<["queued", "running", "waiting_for_approval", "completed", "failed", "cancelled"]>;
    step: z.ZodDefault<z.ZodString>;
    summary: z.ZodDefault<z.ZodString>;
    startedAt: z.ZodString;
    endedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
    organizationId: string;
    agentId: string;
    step: string;
    summary: string;
    startedAt: string;
    threadId?: string | undefined;
    endedAt?: string | undefined;
}, {
    id: string;
    status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
    organizationId: string;
    agentId: string;
    startedAt: string;
    threadId?: string | undefined;
    step?: string | undefined;
    summary?: string | undefined;
    endedAt?: string | undefined;
}>;
export type RunState = z.infer<typeof RunStateSchema>;
//# sourceMappingURL=schemas.d.ts.map
