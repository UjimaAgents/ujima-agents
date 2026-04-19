import { z } from "zod";
import { ApprovalRequestSchema, ChannelSchema, IdSchema, MemberSchema, MessageSchema, PresenceStateSchema, RunStateSchema, } from "./schemas.js";
export const SocketEventNames = Object.freeze({
    channelMessage: "channel:message",
    channelPresence: "channel:presence",
    threadMessage: "thread:message",
    approvalRequested: "approval:requested",
    approvalResolved: "approval:resolved",
    runStarted: "run:started",
    runUpdated: "run:updated",
    runCompleted: "run:completed",
    memberUpdated: "member:updated",
});
export const ChannelMessageEventSchema = z.object({
    organizationId: IdSchema,
    channelId: IdSchema,
    message: MessageSchema,
});
export const ThreadMessageEventSchema = z.object({
    organizationId: IdSchema,
    threadId: IdSchema,
    message: MessageSchema,
});
export const ChannelPresenceEventSchema = z.object({
    organizationId: IdSchema,
    channelId: IdSchema,
    memberId: IdSchema,
    state: PresenceStateSchema,
});
export const ApprovalRequestedEventSchema = z.object({
    organizationId: IdSchema,
    approval: ApprovalRequestSchema,
});
export const ApprovalResolvedEventSchema = z.object({
    organizationId: IdSchema,
    approval: ApprovalRequestSchema,
});
export const RunEventSchema = z.object({
    organizationId: IdSchema,
    run: RunStateSchema,
});
export const MemberUpdatedEventSchema = z.object({
    organizationId: IdSchema,
    member: MemberSchema,
});
export const ChannelUpdatedEventSchema = z.object({
    organizationId: IdSchema,
    channel: ChannelSchema,
});
export const SocketEventSchemas = Object.freeze({
    [SocketEventNames.channelMessage]: ChannelMessageEventSchema,
    [SocketEventNames.channelPresence]: ChannelPresenceEventSchema,
    [SocketEventNames.threadMessage]: ThreadMessageEventSchema,
    [SocketEventNames.approvalRequested]: ApprovalRequestedEventSchema,
    [SocketEventNames.approvalResolved]: ApprovalResolvedEventSchema,
    [SocketEventNames.runStarted]: RunEventSchema,
    [SocketEventNames.runUpdated]: RunEventSchema,
    [SocketEventNames.runCompleted]: RunEventSchema,
    [SocketEventNames.memberUpdated]: MemberUpdatedEventSchema,
});
