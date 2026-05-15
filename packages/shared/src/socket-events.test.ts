import { describe, expect, it } from 'vitest';
import { SocketEventNames, SocketEventSchemas } from './socket-events';

describe('socket-events member.alert_failed', () => {
  it('parses a valid payload', () => {
    const parsed = SocketEventSchemas[SocketEventNames.memberAlertFailed].safeParse({
      organizationId: 'org-1',
      memberId: 'agent-1',
      channelId: 'general',
      threadId: 'thread-1',
      messageId: 'msg-1',
      byMemberId: 'human-1',
      reason: 'mention',
      stage: 'run_failed',
      runId: 'run-1',
      error: 'Model timeout',
      occurredAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects payloads with invalid stage', () => {
    const parsed = SocketEventSchemas[SocketEventNames.memberAlertFailed].safeParse({
      organizationId: 'org-1',
      memberId: 'agent-1',
      messageId: 'msg-1',
      byMemberId: 'human-1',
      reason: 'mention',
      stage: 'unknown',
      error: 'x',
      occurredAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('socket-events run:chunk', () => {
  it('parses streamed text and reasoning chunks', () => {
    const parsed = SocketEventSchemas[SocketEventNames.runChunk].safeParse({
      organizationId: 'org-1',
      runId: 'run-1',
      threadId: 'thread-1',
      agentId: 'agent-1',
      kind: 'text',
      delta: 'Hello',
    });
    expect(parsed.success).toBe(true);
  });
});
