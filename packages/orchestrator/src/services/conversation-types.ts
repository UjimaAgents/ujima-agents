import type { WakeReason } from '@ujima/shared';

export type WakePolicy = 'default' | 'never';

export interface PublishMessageOptions {
  suppressDmAlerts?: boolean;
  silent?: boolean;
  skipMentionResolution?: boolean;
  wakePolicy?: WakePolicy;
}

export interface MemberAlertInput {
  organizationId: string;
  memberId: string;
  channelId?: string;
  threadId: string;
  messageId: string;
  byMemberId: string;
  reason: string;
  wakeReason: WakeReason;
}
