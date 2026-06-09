import type { Message } from '@ujima/shared';
import type { ModelMessage } from 'ai';
import type { RepositoryReader } from '../services/repository-reader.js';
import { filterVisibleMessages } from './message-visibility.js';
import {
  collectInterruptMessages,
  createMessageCursor,
  type MessageCursor,
} from './message-interrupts.js';
import { toModelMessages } from './to-model-messages.js';

export function loadInterruptModelMessages(input: {
  repo: RepositoryReader;
  organizationId: string;
  threadId: string;
  agentId: string;
  cursor: MessageCursor;
  limit?: number;
}): ModelMessage[] {
  const page = filterVisibleMessages(
    input.repo.listMessages(input.organizationId, input.threadId, undefined, input.limit ?? 100).data,
  );
  return toModelMessages(collectInterruptMessages(page, input.cursor, input.agentId), input.agentId);
}

export function loadChannelInterruptModelMessages(input: {
  repo: RepositoryReader & {
    listChannelMessages(
      organizationId: string,
      channelId: string,
      options?: { limit?: number },
    ): { data: Message[] };
  };
  organizationId: string;
  channelId: string;
  agentId: string;
  cursor: MessageCursor;
  limit?: number;
}): ModelMessage[] {
  const page = filterVisibleMessages(
    input.repo.listChannelMessages(input.organizationId, input.channelId, {
      limit: input.limit ?? 100,
    }).data,
  );
  return toModelMessages(collectInterruptMessages(page, input.cursor, input.agentId), input.agentId);
}

export { createMessageCursor };
