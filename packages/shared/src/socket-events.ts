import { z } from 'zod';
import {
  ApprovalRequestSchema,
  ChannelSchema,
  IdSchema,
  MemberSchema,
  MessageSchema,
  PresenceStateSchema,
  RunStateSchema,
  SpiritSchema,
  ToolCallSchema,
  ToolResultSchema,
} from './org-schemas.js';

export function orgRoom(organizationId: string) {
  return `org:${organizationId}`;
}

export function channelRoom(channelId: string) {
  return `channel:${channelId}`;
}

export function threadRoom(threadId: string) {
  return `thread:${threadId}`;
}

export function memberRoom(memberId: string) {
  return `member:${memberId}`;
}

export function runRoom(runId: string) {
  return `run:${runId}`;
}

export const SocketEventNames = Object.freeze({
  channelMessage: 'channel:message',
  channelPresence: 'channel:presence',
  threadMessage: 'thread:message',
  dmMessage: 'dm:message',
  approvalRequested: 'approval:requested',
  approvalResolved: 'approval:resolved',
  runStarted: 'run:started',
  runUpdated: 'run:updated',
  runCompleted: 'run:completed',
  memberUpdated: 'member:updated',
  memberAlerted: 'member.alerted',
  memberAlertFailed: 'member.alert_failed',
  channelArchived: 'channel.archived',
  toolCalled: 'tool:called',
  toolResult: 'tool:result',
  spiritStarted: 'spirit:started',
  spiritUpdated: 'spirit:updated',
  spiritCompleted: 'spirit:completed',
  spiritRetired: 'spirit:retired',
  supervisorReplied: 'supervisor:replied',
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

export const DMMessageEventSchema = z.object({
  organizationId: IdSchema,
  message: MessageSchema,
});
export type DMMessageEvent = z.infer<typeof DMMessageEventSchema>;

export const ChannelPresenceEventSchema = z.object({
  organizationId: IdSchema,
  channelId: IdSchema,
  memberId: IdSchema,
  state: PresenceStateSchema,
});
export type ChannelPresenceEvent = z.infer<typeof ChannelPresenceEventSchema>;

export const ApprovalRequestedEventSchema = z.object({
  organizationId: IdSchema,
  threadId: IdSchema.optional(),
  approval: ApprovalRequestSchema,
});
export type ApprovalRequestedEvent = z.infer<typeof ApprovalRequestedEventSchema>;

export const ApprovalResolvedEventSchema = z.object({
  organizationId: IdSchema,
  threadId: IdSchema.optional(),
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

export const MemberAlertedEventSchema = z.object({
  organizationId: IdSchema,
  memberId: IdSchema,
  channelId: IdSchema.optional(),
  threadId: IdSchema.optional(),
  messageId: IdSchema,
  byMemberId: IdSchema,
  reason: z.string().min(1),
});
export type MemberAlertedEvent = z.infer<typeof MemberAlertedEventSchema>;

export const MemberAlertFailureStageSchema = z.enum([
  'supervisor_dispatch',
  'run_create',
  'run_failed',
]);
export type MemberAlertFailureStage = z.infer<typeof MemberAlertFailureStageSchema>;

export const MemberAlertFailedEventSchema = z.object({
  organizationId: IdSchema,
  memberId: IdSchema,
  channelId: IdSchema.optional(),
  threadId: IdSchema.optional(),
  messageId: IdSchema,
  byMemberId: IdSchema,
  reason: z.string().min(1),
  stage: MemberAlertFailureStageSchema,
  runId: IdSchema.optional(),
  error: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
});
export type MemberAlertFailedEvent = z.infer<typeof MemberAlertFailedEventSchema>;

export const ChannelUpdatedEventSchema = z.object({
  organizationId: IdSchema,
  channel: ChannelSchema,
});
export type ChannelUpdatedEvent = z.infer<typeof ChannelUpdatedEventSchema>;

export const ToolCalledEventSchema = z.object({
  organizationId: IdSchema,
  runId: IdSchema,
  threadId: IdSchema.optional(),
  agentId: IdSchema,
  toolCall: ToolCallSchema,
});
export type ToolCalledEvent = z.infer<typeof ToolCalledEventSchema>;

export const ToolResultEventSchema = z.object({
  organizationId: IdSchema,
  runId: IdSchema,
  threadId: IdSchema.optional(),
  agentId: IdSchema,
  toolResult: ToolResultSchema,
});
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;

export const SpiritEventSchema = z.object({
  organizationId: IdSchema,
  spirit: SpiritSchema,
});
export type SpiritEvent = z.infer<typeof SpiritEventSchema>;

export const SupervisorRepliedEventSchema = z.object({
  organizationId: IdSchema,
  taskSessionId: IdSchema,
  memberId: IdSchema,
  message: MessageSchema,
  reason: z.string().min(1),
});
export type SupervisorRepliedEvent = z.infer<typeof SupervisorRepliedEventSchema>;

export const SocketEventSchemas = Object.freeze({
  [SocketEventNames.channelMessage]: ChannelMessageEventSchema,
  [SocketEventNames.channelPresence]: ChannelPresenceEventSchema,
  [SocketEventNames.threadMessage]: ThreadMessageEventSchema,
  [SocketEventNames.dmMessage]: DMMessageEventSchema,
  [SocketEventNames.approvalRequested]: ApprovalRequestedEventSchema,
  [SocketEventNames.approvalResolved]: ApprovalResolvedEventSchema,
  [SocketEventNames.runStarted]: RunEventSchema,
  [SocketEventNames.runUpdated]: RunEventSchema,
  [SocketEventNames.runCompleted]: RunEventSchema,
  [SocketEventNames.memberUpdated]: MemberUpdatedEventSchema,
  [SocketEventNames.memberAlerted]: MemberAlertedEventSchema,
  [SocketEventNames.memberAlertFailed]: MemberAlertFailedEventSchema,
  [SocketEventNames.channelArchived]: ChannelUpdatedEventSchema,
  [SocketEventNames.toolCalled]: ToolCalledEventSchema,
  [SocketEventNames.toolResult]: ToolResultEventSchema,
  [SocketEventNames.spiritStarted]: SpiritEventSchema,
  [SocketEventNames.spiritUpdated]: SpiritEventSchema,
  [SocketEventNames.spiritCompleted]: SpiritEventSchema,
  [SocketEventNames.spiritRetired]: SpiritEventSchema,
  [SocketEventNames.supervisorReplied]: SupervisorRepliedEventSchema,
});
