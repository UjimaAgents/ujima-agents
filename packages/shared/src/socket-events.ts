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
  TimestampSchema,
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
  runChunk: 'run:chunk',
  memberUpdated: 'member:updated',
  memberAlerted: 'member.alerted',
  memberAlertFailed: 'member.alert_failed',
  memberMustReplyFailed: 'member.must_reply_failed',
  channelArchived: 'channel.archived',
  toolCalled: 'tool:called',
  toolResult: 'tool:result',
  spiritStarted: 'spirit:started',
  spiritUpdated: 'spirit:updated',
  spiritCompleted: 'spirit:completed',
  spiritRetired: 'spirit:retired',
  spiritDispatch: 'spirit:dispatch',
  supervisorReplied: 'supervisor:replied',
  scheduledJobExecuted: 'schedule:executed',
  agentPassed: 'agent:passed',
  agentPassedWithText: 'agent:passed_with_text',
  decisionVerification: 'decision:verification_result',
  agentHandoff: 'agent:handoff',
  wakeSuppressed: 'wake:suppressed',
  runSilentCompletion: 'run:silent_completion',
  runEmptyCompletion: 'run:empty_completion',
});

export type SocketEventName = (typeof SocketEventNames)[keyof typeof SocketEventNames];

/**
 * Why an agent was woken. Drives mandatory-reply enforcement
 * (`channel.pass` and `self.note` are stripped from the tool
 * palette when `wakeReason === 'mention'`, so the model
 * structurally cannot opt out of replying) and observability
 * events.
 *
 * `@all` expansions count as `mention` — the user opted into
 * "everyone respond" by typing `@all`. To reach this agent
 * without forcing a reply, post without `@` or use a system
 * message.
 */
export const WakeReasonSchema = z.enum([
  'mention',
  'dm',
  'channel-read',
  'handoff',
  'parent-thread',
]);
export type WakeReason = z.infer<typeof WakeReasonSchema>;

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

export const RunChunkEventSchema = z.object({
  organizationId: IdSchema,
  runId: IdSchema,
  threadId: IdSchema,
  agentId: IdSchema,
  kind: z.enum(['text', 'reasoning']),
  delta: z.string(),
});
export type RunChunkEvent = z.infer<typeof RunChunkEventSchema>;

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

/**
 * Read-all-speak-when-useful runtime events. See ujima_agents_runtime_plan.md.
 */
export const ChannelPassReasonSchema = z.enum([
  'not_addressed_to_me',
  'already_handled',
  'awaiting_human',
  'out_of_scope',
  'duplicate_reply',
]);
export type ChannelPassReason = z.infer<typeof ChannelPassReasonSchema>;

export const AgentPassedEventSchema = z.object({
  organizationId: IdSchema,
  channelId: IdSchema.optional(),
  threadId: IdSchema.optional(),
  memberId: IdSchema,
  runId: IdSchema,
  reason: ChannelPassReasonSchema,
  note: z.string().optional(),
  occurredAt: TimestampSchema,
});
export type AgentPassedEvent = z.infer<typeof AgentPassedEventSchema>;

export const AgentPassedWithTextEventSchema = z.object({
  organizationId: IdSchema,
  channelId: IdSchema.optional(),
  threadId: IdSchema.optional(),
  memberId: IdSchema,
  runId: IdSchema,
  droppedText: z.string(),
  occurredAt: TimestampSchema,
});
export type AgentPassedWithTextEvent = z.infer<typeof AgentPassedWithTextEventSchema>;

export const AgentHandoffEventSchema = z.object({
  organizationId: IdSchema,
  channelId: IdSchema.optional(),
  threadId: IdSchema.optional(),
  fromMemberId: IdSchema,
  toMemberId: IdSchema,
  runId: IdSchema,
  messageId: IdSchema,
  complete: z.boolean(),
  reason: z.string().min(1),
  occurredAt: TimestampSchema,
});
export type AgentHandoffEvent = z.infer<typeof AgentHandoffEventSchema>;

export const WakeSuppressedReasonSchema = z.enum([
  'roster',
  'self-channel',
  'sender-self',
  'quota',
  'system-message',
  'agent-sender-no-broad-wake',
  'non-agent-member',
  'retired',
  'cross-org',
]);
export type WakeSuppressedReason = z.infer<typeof WakeSuppressedReasonSchema>;

export const WakeSuppressedEventSchema = z.object({
  organizationId: IdSchema,
  channelId: IdSchema.optional(),
  threadId: IdSchema.optional(),
  memberId: IdSchema,
  messageId: IdSchema,
  reason: WakeSuppressedReasonSchema,
  occurredAt: TimestampSchema,
});
export type WakeSuppressedEvent = z.infer<typeof WakeSuppressedEventSchema>;

export const SpiritDispatchKindSchema = z.enum([
  'replied',
  'no-active-spirit',
  'debounced',
]);
export type SpiritDispatchKind = z.infer<typeof SpiritDispatchKindSchema>;

export const SpiritDispatchEventSchema = z.object({
  organizationId: IdSchema,
  memberId: IdSchema,
  taskSessionId: IdSchema.optional(),
  kind: SpiritDispatchKindSchema,
  occurredAt: TimestampSchema,
});
export type SpiritDispatchEvent = z.infer<typeof SpiritDispatchEventSchema>;

export const RunSilentCompletionEventSchema = z.object({
  organizationId: IdSchema,
  runId: IdSchema,
  memberId: IdSchema,
  wakeReason: WakeReasonSchema.optional(),
  occurredAt: TimestampSchema,
});
export type RunSilentCompletionEvent = z.infer<typeof RunSilentCompletionEventSchema>;

export const RunEmptyCompletionEventSchema = z.object({
  organizationId: IdSchema,
  runId: IdSchema,
  memberId: IdSchema,
  wakeReason: WakeReasonSchema.optional(),
  occurredAt: TimestampSchema,
});
export type RunEmptyCompletionEvent = z.infer<typeof RunEmptyCompletionEventSchema>;

/**
 * Shadow-mode verification result for a `channel.pass` decision.
 * Emitted alongside every pass so we can collect a labeled dataset
 * (verified=true vs verified=false) BEFORE enforcing — Google
 * engineer principle: instrument first, then act. No runtime
 * action is taken on `verified=false` until the data justifies it.
 */
export const DecisionVerificationFailureSchema = z.enum([
  'not_addressed_to_me_but_self_was_mentioned',
  'not_addressed_to_me_but_name_referenced',
  'already_handled_but_no_prior_responder',
  'already_handled_cited_message_not_found',
  'already_handled_quoted_text_not_present',
  'duplicate_reply_but_no_prior_self_message',
  'duplicate_reply_cited_message_not_found',
  'awaiting_human_but_last_message_was_human',
]);
export type DecisionVerificationFailure = z.infer<typeof DecisionVerificationFailureSchema>;

export const DecisionVerificationEventSchema = z.object({
  organizationId: IdSchema,
  channelId: IdSchema.optional(),
  threadId: IdSchema.optional(),
  memberId: IdSchema,
  runId: IdSchema,
  decision: z.enum(['channel.pass']),
  claimedReason: z.string().min(1),
  verified: z.boolean(),
  failureKinds: z.array(DecisionVerificationFailureSchema).default([]),
  occurredAt: TimestampSchema,
});
export type DecisionVerificationEvent = z.infer<typeof DecisionVerificationEventSchema>;

export const MemberMustReplyFailedEventSchema = z.object({
  organizationId: IdSchema,
  runId: IdSchema,
  memberId: IdSchema,
  byMemberId: IdSchema,
  channelId: IdSchema.optional(),
  threadId: IdSchema.optional(),
  messageId: IdSchema,
  occurredAt: TimestampSchema,
});
export type MemberMustReplyFailedEvent = z.infer<typeof MemberMustReplyFailedEventSchema>;

export const ScheduledJobExecutedEventSchema = z.object({
  organizationId: IdSchema,
  jobName: z.string().min(1),
  channelId: IdSchema.optional(),
  prompt: z.string(),
});
export type ScheduledJobExecutedEvent = z.infer<typeof ScheduledJobExecutedEventSchema>;

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
  [SocketEventNames.runChunk]: RunChunkEventSchema,
  [SocketEventNames.memberUpdated]: MemberUpdatedEventSchema,
  [SocketEventNames.memberAlerted]: MemberAlertedEventSchema,
  [SocketEventNames.memberAlertFailed]: MemberAlertFailedEventSchema,
  [SocketEventNames.memberMustReplyFailed]: MemberMustReplyFailedEventSchema,
  [SocketEventNames.channelArchived]: ChannelUpdatedEventSchema,
  [SocketEventNames.toolCalled]: ToolCalledEventSchema,
  [SocketEventNames.toolResult]: ToolResultEventSchema,
  [SocketEventNames.spiritStarted]: SpiritEventSchema,
  [SocketEventNames.spiritUpdated]: SpiritEventSchema,
  [SocketEventNames.spiritCompleted]: SpiritEventSchema,
  [SocketEventNames.spiritRetired]: SpiritEventSchema,
  [SocketEventNames.spiritDispatch]: SpiritDispatchEventSchema,
  [SocketEventNames.supervisorReplied]: SupervisorRepliedEventSchema,
  [SocketEventNames.scheduledJobExecuted]: ScheduledJobExecutedEventSchema,
  [SocketEventNames.agentPassed]: AgentPassedEventSchema,
  [SocketEventNames.agentPassedWithText]: AgentPassedWithTextEventSchema,
  [SocketEventNames.decisionVerification]: DecisionVerificationEventSchema,
  [SocketEventNames.agentHandoff]: AgentHandoffEventSchema,
  [SocketEventNames.wakeSuppressed]: WakeSuppressedEventSchema,
  [SocketEventNames.runSilentCompletion]: RunSilentCompletionEventSchema,
  [SocketEventNames.runEmptyCompletion]: RunEmptyCompletionEventSchema,
});
