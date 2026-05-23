import { randomUUID } from 'node:crypto';
import {
  MessageSchema,
  SocketEventNames,
  channelRoom,
  memberRoom,
  orgRoom,
  type Message,
  AGENT_KIND,
  isDirectMessageThread,
} from '@ujima/shared';
import { MESSAGE_TOOL_USAGE_GUIDANCE } from '@ujima/framework';
import type { ActiveSpiritEntry } from './active-spirit-registry.js';
import type {
  SpiritAlertDispatchResult,
  SpiritAlertInput,
  SpiritSupervisorReplyOutcome,
} from './spirit-types.js';
import { goalModeSystemPromptSuffix, goalModeEnabledFromMessage } from './goal-mode-prompt.js';
import { SpiritServiceAgentRun } from './spirit-agent-run.js';

export class SpiritServiceSupervisor extends SpiritServiceAgentRun {
  async handleAlert(input: SpiritAlertInput): Promise<SpiritAlertDispatchResult> {
    const active = this.registry.getActiveForMember(input.organizationId, input.memberId);
    if (active.length === 0) {
      return { kind: 'no-active-spirit' };
    }
    const target = this.findActiveSpiritForThread(
      active,
      input.organizationId,
      input.threadId,
      input.channelId,
    );
    if (!target) {
      return { kind: 'no-active-spirit' };
    }
    const debounceMessageKey =
      input.wakeReason === 'mention' || input.wakeReason === 'dm' ? input.messageId : undefined;
    if (
      this.shouldDebounceSupervisorAlert(
        input.organizationId,
        input.memberId,
        target.taskSessionId,
        debounceMessageKey,
      )
    ) {
      return { kind: 'debounced' };
    }

    this.supervisorLastAlertAt.set(
      this.supervisorDebounceKey(
        input.organizationId,
        input.memberId,
        target.taskSessionId,
        debounceMessageKey,
      ),
      Date.now(),
    );

    const mutexKey = this.supervisorMutexKey(input.organizationId, input.memberId, target.taskSessionId);
    const previous = this.supervisorMutexes.get(mutexKey) ?? Promise.resolve();
    const next = previous.then(() => this.runSupervisorAlertTurn(target.taskSessionId, input));
    this.supervisorMutexes.set(
      mutexKey,
      next.catch(() => undefined).finally(() => {
        if (this.supervisorMutexes.get(mutexKey) === next) {
          this.supervisorMutexes.delete(mutexKey);
        }
      }),
    );

    const outcome = await next;
    return { kind: 'replied', outcome };
  }

  protected async runSupervisorAlertTurn(
    taskSessionId: string,
    input: SpiritAlertInput,
  ): Promise<SpiritSupervisorReplyOutcome> {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    if (!session) {
      const fallback = this.publishSupervisorFallback(taskSessionId, input, 'Task session not found');
      return { taskSessionId, message: fallback, fallback: true, reason: 'session-missing' };
    }
    if (session.supervisorTurnCount >= this.supervisorTurnCapPerSession) {
      const fallback = this.publishSupervisorCapMessage(taskSessionId, input);
      return { taskSessionId, message: fallback, fallback: true, reason: 'cap-reached' };
    }

    const sourceMessage = this.repo.getMessage(input.organizationId, input.messageId);
    const goalModeSuffix = goalModeSystemPromptSuffix({
      goalMode: goalModeEnabledFromMessage(sourceMessage),
      messageContent: sourceMessage?.content,
    });

    if (input.wakeReason) {
      const supervisorSpirit = this.repo
        .listActiveSpiritsForMember(input.organizationId, input.memberId)
        .find((s) => s.taskSessionId === taskSessionId);
      const runId = supervisorSpirit?.runId;
      if (runId) {
        const run = this.repo.getRun(input.organizationId, runId);
        if (run) {
          this.repo.saveRun({
            ...run,
            wakeReason: input.wakeReason,
            sourceMessageId: input.messageId,
            byMemberId: input.byMemberId,
          });
        }
      }
    }

    try {
      const outcome = await this.run({
        organizationId: input.organizationId,
        taskSessionId,
        memberId: input.memberId,
        role: 'supervisor',
        maxIterations: 2,
        extraPrompt: this.buildSupervisorAlertContext(taskSessionId, input),
        systemPromptSuffix: goalModeSuffix,
      });
      this.repo.saveTaskSession({
        ...session,
        supervisorTurnCount: session.supervisorTurnCount + 1,
        updatedAt: new Date().toISOString(),
      });
      const replyText = outcome.finalText.trim();
      const publishedViaTool =
        outcome.terminatingTool !== null &&
        outcome.terminatingTool !== 'channel.pass' &&
        outcome.terminatingTool !== 'channel.ack';
      if (!replyText && !publishedViaTool && input.wakeReason === 'mention') {
        this.realtime.emit(
          SocketEventNames.memberMustReplyFailed,
          {
            organizationId: input.organizationId,
            runId: outcome.spirit.runId ?? input.messageId,
            memberId: input.memberId,
            byMemberId: input.byMemberId,
            channelId: input.channelId,
            threadId: input.threadId,
            messageId: input.messageId,
            occurredAt: new Date().toISOString(),
          },
          [orgRoom(input.organizationId), memberRoom(input.memberId)],
        );
        const failureMessage = this.publishSupervisorFallback(
          taskSessionId,
          input,
          'mandatory-reply violated: supervisor produced no answer to a @mention',
        );
        return {
          taskSessionId,
          message: failureMessage,
          fallback: true,
          reason: 'must_reply_failed',
        };
      }
      if (publishedViaTool) {
        return {
          taskSessionId,
          message: null,
          fallback: false,
          reason: 'ok',
        };
      }
      const finalText = replyText || `Currently on step ${session.status} of #${session.slug}.`;
      const message = this.publishSupervisorReply(taskSessionId, input, finalText, false);
      return { taskSessionId, message, fallback: false, reason: 'ok' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const message = this.publishSupervisorFallback(taskSessionId, input, reason);
      return { taskSessionId, message, fallback: true, reason };
    }
  }

  protected buildSupervisorAlertContext(
    taskSessionId: string,
    input: SpiritAlertInput,
  ): string {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    const sourceMessage = this.repo.getMessage(input.organizationId, input.messageId);
    const body = sourceMessage?.content ?? '';
    const fromMember = this.repo.getMember(input.organizationId, input.byMemberId);
    let commandSurface = '';
    if (session) {
      const requester = this.repo.getMember(input.organizationId, session.requestedBy);
      const parts = [`requested by ${requester?.name ?? session.requestedBy}`];
      if (session.origin.channelId) {
        const channel = this.repo.getChannel(input.organizationId, session.origin.channelId);
        parts.push(`channel ${channel?.name ?? session.origin.channelId}`);
      }
      if (session.origin.threadId) parts.push(`thread ${session.origin.threadId}`);
      if (session.origin.messageId) parts.push(`origin message ${session.origin.messageId}`);
      commandSurface = parts.join('; ');
    }

    return [
      'You are answering a quick supervisor question or carrying out a direct action request.',
      ...MESSAGE_TOOL_USAGE_GUIDANCE,
      'If the request is only asking for status, give a short one-paragraph update.',
      `Reason: ${input.reason}`,
      `From: ${fromMember?.name ?? input.byMemberId}`,
      commandSurface ? `Human command surface: ${commandSurface}` : '',
      sourceMessage ? `Alert thread: ${sourceMessage.channelId ?? input.threadId}` : '',
      body ? `Message: ${body}` : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }

  protected publishSupervisorReply(
    taskSessionId: string,
    input: SpiritAlertInput,
    body: string,
    fallback: boolean,
  ): Message {
    if (!this.conversations) {
      throw new Error('Conversation service is required for supervisor replies');
    }
    const sourceMessage = this.repo.getMessage(input.organizationId, input.messageId);
    const channelId = sourceMessage?.channelId ?? input.channelId;
    if (!channelId) {
      return this.conversations.sendSelfNote({
        organizationId: input.organizationId,
        memberId: input.memberId,
        body,
      });
    }
    const message = MessageSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      threadId: sourceMessage?.threadId ?? input.threadId,
      channelId,
      parentMessageId: sourceMessage?.id,
      senderId: input.memberId,
      senderKind: AGENT_KIND,
      kind: AGENT_KIND,
      content: body,
      createdAt: new Date().toISOString(),
    });
    this.conversations.publishMessage(message, []);
    this.realtime.emit(
      SocketEventNames.supervisorReplied,
      {
        organizationId: input.organizationId,
        taskSessionId,
        memberId: input.memberId,
        message,
        reason: fallback ? 'fallback' : input.reason,
      },
      [orgRoom(input.organizationId), channelRoom(channelId), memberRoom(input.memberId)],
    );
    return message;
  }

  protected publishSupervisorFallback(
    taskSessionId: string,
    input: SpiritAlertInput,
    reason: string,
  ): Message {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    const slug = session?.slug ?? taskSessionId;
    const summary = session?.summary?.trim() || (session ? `step ${session.status}` : 'in progress');
    const body = `Currently on ${summary} of #${slug}. Full activity in #${slug}. (supervisor fallback: ${reason})`;
    return this.publishSupervisorReply(taskSessionId, input, body, true);
  }

  protected publishSupervisorCapMessage(taskSessionId: string, input: SpiritAlertInput): Message {
    const session = this.repo.getTaskSession(input.organizationId, taskSessionId);
    const slug = session?.slug ?? taskSessionId;
    const body = `Supervisor turn cap reached for #${slug} (${this.supervisorTurnCapPerSession} turns). Full activity in #${slug}.`;
    return this.publishSupervisorReply(taskSessionId, input, body, true);
  }

  protected supervisorMutexKey(organizationId: string, memberId: string, taskSessionId: string): string {
    return `${organizationId}:${memberId}:${taskSessionId}:supervisor`;
  }

  protected supervisorDebounceKey(
    organizationId: string,
    memberId: string,
    taskSessionId: string,
    messageId?: string,
  ): string {
    const base = `${organizationId}:${memberId}:${taskSessionId}`;
    return messageId ? `${base}:msg:${messageId}` : base;
  }

  protected shouldDebounceSupervisorAlert(
    organizationId: string,
    memberId: string,
    taskSessionId: string,
    messageId?: string,
  ): boolean {
    const last = this.supervisorLastAlertAt.get(
      this.supervisorDebounceKey(organizationId, memberId, taskSessionId, messageId),
    );
    if (last === undefined) return false;
    return Date.now() - last < this.supervisorDebounceMs;
  }

  protected isBroadOrgChannelSurface(
    organizationId: string,
    threadId: string,
    channelId?: string,
  ): boolean {
    const getChannel = this.repo.getChannel;
    if (typeof getChannel !== 'function') return false;
    const check = (surfaceId: string): boolean => {
      const ch = getChannel.call(this.repo, organizationId, surfaceId);
      if (!ch) return false;
      return ch.kind === 'general' || ch.kind === 'group';
    };
    if (check(threadId)) return true;
    if (channelId && channelId !== threadId && check(channelId)) return true;
    return false;
  }

  protected findActiveSpiritForThread(
    active: ActiveSpiritEntry[],
    organizationId: string,
    threadId: string,
    channelId?: string,
  ): ActiveSpiritEntry | null {
    if (active.length === 0) return null;

    const matchesSurface = (entry: ActiveSpiritEntry): boolean => {
      const session = this.repo.getTaskSession(entry.organizationId, entry.taskSessionId);
      if (!session) return false;
      if (session.channelId === threadId || (channelId !== undefined && session.channelId === channelId)) {
        return true;
      }
      const { origin } = session;
      if (
        origin.channelId &&
        (origin.channelId === threadId || (channelId !== undefined && origin.channelId === channelId))
      ) {
        return true;
      }
      if (origin.threadId && origin.threadId === threadId) {
        return true;
      }
      return false;
    };

    const direct = active.find((entry) => matchesSurface(entry));
    if (direct) return direct;

    if (
      isDirectMessageThread(threadId) ||
      (channelId !== undefined && isDirectMessageThread(channelId))
    ) {
      return null;
    }

    if (this.isBroadOrgChannelSurface(organizationId, threadId, channelId)) {
      return active[0] ?? null;
    }
    return null;
  }
}
