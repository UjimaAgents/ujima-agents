import { z } from "zod";
export declare const SocketEventNames: Readonly<{
    channelMessage: "channel:message";
    channelPresence: "channel:presence";
    threadMessage: "thread:message";
    approvalRequested: "approval:requested";
    approvalResolved: "approval:resolved";
    runStarted: "run:started";
    runUpdated: "run:updated";
    runCompleted: "run:completed";
    memberUpdated: "member:updated";
}>;
export type SocketEventName = (typeof SocketEventNames)[keyof typeof SocketEventNames];
export declare const ChannelMessageEventSchema: z.ZodObject<{
    organizationId: z.ZodString;
    channelId: z.ZodString;
    message: z.ZodObject<{
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
}, "strip", z.ZodTypeAny, {
    message: {
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
    };
    organizationId: string;
    channelId: string;
}, {
    message: {
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
    };
    organizationId: string;
    channelId: string;
}>;
export type ChannelMessageEvent = z.infer<typeof ChannelMessageEventSchema>;
export declare const ThreadMessageEventSchema: z.ZodObject<{
    organizationId: z.ZodString;
    threadId: z.ZodString;
    message: z.ZodObject<{
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
}, "strip", z.ZodTypeAny, {
    message: {
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
    };
    organizationId: string;
    threadId: string;
}, {
    message: {
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
    };
    organizationId: string;
    threadId: string;
}>;
export type ThreadMessageEvent = z.infer<typeof ThreadMessageEventSchema>;
export declare const ChannelPresenceEventSchema: z.ZodObject<{
    organizationId: z.ZodString;
    channelId: z.ZodString;
    memberId: z.ZodString;
    state: z.ZodEnum<["online", "offline", "busy", "away"]>;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    channelId: string;
    memberId: string;
    state: "online" | "offline" | "busy" | "away";
}, {
    organizationId: string;
    channelId: string;
    memberId: string;
    state: "online" | "offline" | "busy" | "away";
}>;
export type ChannelPresenceEvent = z.infer<typeof ChannelPresenceEventSchema>;
export declare const ApprovalRequestedEventSchema: z.ZodObject<{
    organizationId: z.ZodString;
    approval: z.ZodObject<{
        id: z.ZodString;
        organizationId: z.ZodString;
        runId: z.ZodOptional<z.ZodString>;
        requestedBy: z.ZodString;
        resourceType: z.ZodEnum<["file", "folder", "shell", "git", "mcp"]>;
        resourcePath: z.ZodString;
        action: z.ZodEnum<["read", "write", "execute", "git", "mcp"]>;
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
        resourceType: "git" | "mcp" | "file" | "folder" | "shell";
        resourcePath: string;
        action: "read" | "write" | "execute" | "git" | "mcp";
        reason: string;
        runId?: string | undefined;
        resolvedAt?: string | undefined;
    }, {
        id: string;
        organizationId: string;
        createdAt: string;
        requestedBy: string;
        resourceType: "git" | "mcp" | "file" | "folder" | "shell";
        resourcePath: string;
        action: "read" | "write" | "execute" | "git" | "mcp";
        status?: "pending" | "approved" | "rejected" | undefined;
        runId?: string | undefined;
        reason?: string | undefined;
        resolvedAt?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    approval: {
        id: string;
        status: "pending" | "approved" | "rejected";
        organizationId: string;
        createdAt: string;
        requestedBy: string;
        resourceType: "git" | "mcp" | "file" | "folder" | "shell";
        resourcePath: string;
        action: "read" | "write" | "execute" | "git" | "mcp";
        reason: string;
        runId?: string | undefined;
        resolvedAt?: string | undefined;
    };
}, {
    organizationId: string;
    approval: {
        id: string;
        organizationId: string;
        createdAt: string;
        requestedBy: string;
        resourceType: "git" | "mcp" | "file" | "folder" | "shell";
        resourcePath: string;
        action: "read" | "write" | "execute" | "git" | "mcp";
        status?: "pending" | "approved" | "rejected" | undefined;
        runId?: string | undefined;
        reason?: string | undefined;
        resolvedAt?: string | undefined;
    };
}>;
export type ApprovalRequestedEvent = z.infer<typeof ApprovalRequestedEventSchema>;
export declare const ApprovalResolvedEventSchema: z.ZodObject<{
    organizationId: z.ZodString;
    approval: z.ZodObject<{
        id: z.ZodString;
        organizationId: z.ZodString;
        runId: z.ZodOptional<z.ZodString>;
        requestedBy: z.ZodString;
        resourceType: z.ZodEnum<["file", "folder", "shell", "git", "mcp"]>;
        resourcePath: z.ZodString;
        action: z.ZodEnum<["read", "write", "execute", "git", "mcp"]>;
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
        resourceType: "git" | "mcp" | "file" | "folder" | "shell";
        resourcePath: string;
        action: "read" | "write" | "execute" | "git" | "mcp";
        reason: string;
        runId?: string | undefined;
        resolvedAt?: string | undefined;
    }, {
        id: string;
        organizationId: string;
        createdAt: string;
        requestedBy: string;
        resourceType: "git" | "mcp" | "file" | "folder" | "shell";
        resourcePath: string;
        action: "read" | "write" | "execute" | "git" | "mcp";
        status?: "pending" | "approved" | "rejected" | undefined;
        runId?: string | undefined;
        reason?: string | undefined;
        resolvedAt?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    approval: {
        id: string;
        status: "pending" | "approved" | "rejected";
        organizationId: string;
        createdAt: string;
        requestedBy: string;
        resourceType: "git" | "mcp" | "file" | "folder" | "shell";
        resourcePath: string;
        action: "read" | "write" | "execute" | "git" | "mcp";
        reason: string;
        runId?: string | undefined;
        resolvedAt?: string | undefined;
    };
}, {
    organizationId: string;
    approval: {
        id: string;
        organizationId: string;
        createdAt: string;
        requestedBy: string;
        resourceType: "git" | "mcp" | "file" | "folder" | "shell";
        resourcePath: string;
        action: "read" | "write" | "execute" | "git" | "mcp";
        status?: "pending" | "approved" | "rejected" | undefined;
        runId?: string | undefined;
        reason?: string | undefined;
        resolvedAt?: string | undefined;
    };
}>;
export type ApprovalResolvedEvent = z.infer<typeof ApprovalResolvedEventSchema>;
export declare const RunEventSchema: z.ZodObject<{
    organizationId: z.ZodString;
    run: z.ZodObject<{
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
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    run: {
        id: string;
        status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
        organizationId: string;
        agentId: string;
        step: string;
        summary: string;
        startedAt: string;
        threadId?: string | undefined;
        endedAt?: string | undefined;
    };
}, {
    organizationId: string;
    run: {
        id: string;
        status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
        organizationId: string;
        agentId: string;
        startedAt: string;
        threadId?: string | undefined;
        step?: string | undefined;
        summary?: string | undefined;
        endedAt?: string | undefined;
    };
}>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export declare const MemberUpdatedEventSchema: z.ZodObject<{
    organizationId: z.ZodString;
    member: z.ZodObject<{
        id: z.ZodString;
        organizationId: z.ZodString;
        name: z.ZodString;
        kind: z.ZodEnum<["human", "agent"]>;
        roleName: z.ZodString;
        presence: z.ZodDefault<z.ZodEnum<["online", "offline", "busy", "away"]>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        kind: "human" | "agent";
        organizationId: string;
        roleName: string;
        presence: "online" | "offline" | "busy" | "away";
    }, {
        id: string;
        name: string;
        kind: "human" | "agent";
        organizationId: string;
        roleName: string;
        presence?: "online" | "offline" | "busy" | "away" | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    member: {
        id: string;
        name: string;
        kind: "human" | "agent";
        organizationId: string;
        roleName: string;
        presence: "online" | "offline" | "busy" | "away";
    };
    organizationId: string;
}, {
    member: {
        id: string;
        name: string;
        kind: "human" | "agent";
        organizationId: string;
        roleName: string;
        presence?: "online" | "offline" | "busy" | "away" | undefined;
    };
    organizationId: string;
}>;
export type MemberUpdatedEvent = z.infer<typeof MemberUpdatedEventSchema>;
export declare const ChannelUpdatedEventSchema: z.ZodObject<{
    organizationId: z.ZodString;
    channel: z.ZodObject<{
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
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    channel: {
        id: string;
        topic: string;
        name: string;
        kind: "general" | "group" | "dm";
        memberIds: string[];
        organizationId?: string | undefined;
    };
}, {
    organizationId: string;
    channel: {
        id: string;
        name: string;
        kind: "general" | "group" | "dm";
        topic?: string | undefined;
        memberIds?: string[] | undefined;
        organizationId?: string | undefined;
    };
}>;
export type ChannelUpdatedEvent = z.infer<typeof ChannelUpdatedEventSchema>;
export declare const SocketEventSchemas: Readonly<{
    "channel:message": z.ZodObject<{
        organizationId: z.ZodString;
        channelId: z.ZodString;
        message: z.ZodObject<{
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
    }, "strip", z.ZodTypeAny, {
        message: {
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
        };
        organizationId: string;
        channelId: string;
    }, {
        message: {
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
        };
        organizationId: string;
        channelId: string;
    }>;
    "channel:presence": z.ZodObject<{
        organizationId: z.ZodString;
        channelId: z.ZodString;
        memberId: z.ZodString;
        state: z.ZodEnum<["online", "offline", "busy", "away"]>;
    }, "strip", z.ZodTypeAny, {
        organizationId: string;
        channelId: string;
        memberId: string;
        state: "online" | "offline" | "busy" | "away";
    }, {
        organizationId: string;
        channelId: string;
        memberId: string;
        state: "online" | "offline" | "busy" | "away";
    }>;
    "thread:message": z.ZodObject<{
        organizationId: z.ZodString;
        threadId: z.ZodString;
        message: z.ZodObject<{
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
    }, "strip", z.ZodTypeAny, {
        message: {
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
        };
        organizationId: string;
        threadId: string;
    }, {
        message: {
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
        };
        organizationId: string;
        threadId: string;
    }>;
    "approval:requested": z.ZodObject<{
        organizationId: z.ZodString;
        approval: z.ZodObject<{
            id: z.ZodString;
            organizationId: z.ZodString;
            runId: z.ZodOptional<z.ZodString>;
            requestedBy: z.ZodString;
            resourceType: z.ZodEnum<["file", "folder", "shell", "git", "mcp"]>;
            resourcePath: z.ZodString;
            action: z.ZodEnum<["read", "write", "execute", "git", "mcp"]>;
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
            resourceType: "git" | "mcp" | "file" | "folder" | "shell";
            resourcePath: string;
            action: "read" | "write" | "execute" | "git" | "mcp";
            reason: string;
            runId?: string | undefined;
            resolvedAt?: string | undefined;
        }, {
            id: string;
            organizationId: string;
            createdAt: string;
            requestedBy: string;
            resourceType: "git" | "mcp" | "file" | "folder" | "shell";
            resourcePath: string;
            action: "read" | "write" | "execute" | "git" | "mcp";
            status?: "pending" | "approved" | "rejected" | undefined;
            runId?: string | undefined;
            reason?: string | undefined;
            resolvedAt?: string | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        organizationId: string;
        approval: {
            id: string;
            status: "pending" | "approved" | "rejected";
            organizationId: string;
            createdAt: string;
            requestedBy: string;
            resourceType: "git" | "mcp" | "file" | "folder" | "shell";
            resourcePath: string;
            action: "read" | "write" | "execute" | "git" | "mcp";
            reason: string;
            runId?: string | undefined;
            resolvedAt?: string | undefined;
        };
    }, {
        organizationId: string;
        approval: {
            id: string;
            organizationId: string;
            createdAt: string;
            requestedBy: string;
            resourceType: "git" | "mcp" | "file" | "folder" | "shell";
            resourcePath: string;
            action: "read" | "write" | "execute" | "git" | "mcp";
            status?: "pending" | "approved" | "rejected" | undefined;
            runId?: string | undefined;
            reason?: string | undefined;
            resolvedAt?: string | undefined;
        };
    }>;
    "approval:resolved": z.ZodObject<{
        organizationId: z.ZodString;
        approval: z.ZodObject<{
            id: z.ZodString;
            organizationId: z.ZodString;
            runId: z.ZodOptional<z.ZodString>;
            requestedBy: z.ZodString;
            resourceType: z.ZodEnum<["file", "folder", "shell", "git", "mcp"]>;
            resourcePath: z.ZodString;
            action: z.ZodEnum<["read", "write", "execute", "git", "mcp"]>;
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
            resourceType: "git" | "mcp" | "file" | "folder" | "shell";
            resourcePath: string;
            action: "read" | "write" | "execute" | "git" | "mcp";
            reason: string;
            runId?: string | undefined;
            resolvedAt?: string | undefined;
        }, {
            id: string;
            organizationId: string;
            createdAt: string;
            requestedBy: string;
            resourceType: "git" | "mcp" | "file" | "folder" | "shell";
            resourcePath: string;
            action: "read" | "write" | "execute" | "git" | "mcp";
            status?: "pending" | "approved" | "rejected" | undefined;
            runId?: string | undefined;
            reason?: string | undefined;
            resolvedAt?: string | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        organizationId: string;
        approval: {
            id: string;
            status: "pending" | "approved" | "rejected";
            organizationId: string;
            createdAt: string;
            requestedBy: string;
            resourceType: "git" | "mcp" | "file" | "folder" | "shell";
            resourcePath: string;
            action: "read" | "write" | "execute" | "git" | "mcp";
            reason: string;
            runId?: string | undefined;
            resolvedAt?: string | undefined;
        };
    }, {
        organizationId: string;
        approval: {
            id: string;
            organizationId: string;
            createdAt: string;
            requestedBy: string;
            resourceType: "git" | "mcp" | "file" | "folder" | "shell";
            resourcePath: string;
            action: "read" | "write" | "execute" | "git" | "mcp";
            status?: "pending" | "approved" | "rejected" | undefined;
            runId?: string | undefined;
            reason?: string | undefined;
            resolvedAt?: string | undefined;
        };
    }>;
    "run:started": z.ZodObject<{
        organizationId: z.ZodString;
        run: z.ZodObject<{
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
    }, "strip", z.ZodTypeAny, {
        organizationId: string;
        run: {
            id: string;
            status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
            organizationId: string;
            agentId: string;
            step: string;
            summary: string;
            startedAt: string;
            threadId?: string | undefined;
            endedAt?: string | undefined;
        };
    }, {
        organizationId: string;
        run: {
            id: string;
            status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
            organizationId: string;
            agentId: string;
            startedAt: string;
            threadId?: string | undefined;
            step?: string | undefined;
            summary?: string | undefined;
            endedAt?: string | undefined;
        };
    }>;
    "run:updated": z.ZodObject<{
        organizationId: z.ZodString;
        run: z.ZodObject<{
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
    }, "strip", z.ZodTypeAny, {
        organizationId: string;
        run: {
            id: string;
            status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
            organizationId: string;
            agentId: string;
            step: string;
            summary: string;
            startedAt: string;
            threadId?: string | undefined;
            endedAt?: string | undefined;
        };
    }, {
        organizationId: string;
        run: {
            id: string;
            status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
            organizationId: string;
            agentId: string;
            startedAt: string;
            threadId?: string | undefined;
            step?: string | undefined;
            summary?: string | undefined;
            endedAt?: string | undefined;
        };
    }>;
    "run:completed": z.ZodObject<{
        organizationId: z.ZodString;
        run: z.ZodObject<{
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
    }, "strip", z.ZodTypeAny, {
        organizationId: string;
        run: {
            id: string;
            status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
            organizationId: string;
            agentId: string;
            step: string;
            summary: string;
            startedAt: string;
            threadId?: string | undefined;
            endedAt?: string | undefined;
        };
    }, {
        organizationId: string;
        run: {
            id: string;
            status: "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
            organizationId: string;
            agentId: string;
            startedAt: string;
            threadId?: string | undefined;
            step?: string | undefined;
            summary?: string | undefined;
            endedAt?: string | undefined;
        };
    }>;
    "member:updated": z.ZodObject<{
        organizationId: z.ZodString;
        member: z.ZodObject<{
            id: z.ZodString;
            organizationId: z.ZodString;
            name: z.ZodString;
            kind: z.ZodEnum<["human", "agent"]>;
            roleName: z.ZodString;
            presence: z.ZodDefault<z.ZodEnum<["online", "offline", "busy", "away"]>>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            name: string;
            kind: "human" | "agent";
            organizationId: string;
            roleName: string;
            presence: "online" | "offline" | "busy" | "away";
        }, {
            id: string;
            name: string;
            kind: "human" | "agent";
            organizationId: string;
            roleName: string;
            presence?: "online" | "offline" | "busy" | "away" | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        member: {
            id: string;
            name: string;
            kind: "human" | "agent";
            organizationId: string;
            roleName: string;
            presence: "online" | "offline" | "busy" | "away";
        };
        organizationId: string;
    }, {
        member: {
            id: string;
            name: string;
            kind: "human" | "agent";
            organizationId: string;
            roleName: string;
            presence?: "online" | "offline" | "busy" | "away" | undefined;
        };
        organizationId: string;
    }>;
}>;
//# sourceMappingURL=events.d.ts.map