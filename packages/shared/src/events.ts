import { z } from "zod";
import {
  ApprovalRequestSchema,
  ChannelSchema,
  IdSchema,
  MemberSchema,
  MessageSchema,
  PresenceStateSchema,
  RunStateSchema,
} from "./schemas.js";

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

export type SocketEventName = (typeof SocketEventNames)[keyof typeof SocketEventNames];

export const ChannelMessageEventSchema = z.object({
  organizationId: IdSchema,
  channelId: IdSchema,
  message: MessageSchema,
});
export type ChannelMessageEvent = z.infer<typeof ChannelMessageEventSchema>;

export const ThreadMessageEventSchema = z.object({
  organizationId: IdSchema,
  threadId: IdSchema,
  message: MessageSchema,
});
export type ThreadMessageEvent = z.infer<typeof ThreadMessageEventSchema>;

export const ChannelPresenceEventSchema = z.object({
  organizationId: IdSchema,
  channelId: IdSchema,
  memberId: IdSchema,
  state: PresenceStateSchema,
});
export type ChannelPresenceEvent = z.infer<typeof ChannelPresenceEventSchema>;

export const ApprovalRequestedEventSchema = z.object({
  organizationId: IdSchema,
  approval: ApprovalRequestSchema,
});
export type ApprovalRequestedEvent = z.infer<typeof ApprovalRequestedEventSchema>;

export const ApprovalResolvedEventSchema = z.object({
  organizationId: IdSchema,
  approval: ApprovalRequestSchema,
});
export type ApprovalResolvedEvent = z.infer<typeof ApprovalResolvedEventSchema>;

export const RunEventSchema = z.object({
  organizationId: IdSchema,
  run: RunStateSchema,
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const MemberUpdatedEventSchema = z.object({
  organizationId: IdSchema,
  member: MemberSchema,
});
export type MemberUpdatedEvent = z.infer<typeof MemberUpdatedEventSchema>;

export const ChannelUpdatedEventSchema = z.object({
  organizationId: IdSchema,
  channel: ChannelSchema,
});
export type ChannelUpdatedEvent = z.infer<typeof ChannelUpdatedEventSchema>;

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
