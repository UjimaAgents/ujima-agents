import type { Message } from '@ujima/shared';
import { encodeCursor } from '@ujima/shared';
import type { ModelMessage } from 'ai';
import type { RepositoryReader } from '../services/repository-reader.js';
import { filterVisibleMessages } from './message-visibility.js';
import {
  collectInterruptMessages,
  createMessageCursor,
  type MessageCursor,
} from './message-interrupts.js';
import { recordRunInterruptCursor } from './interrupt-run-state.js';
import { toModelMessages } from './to-model-messages.js';

export function loadInterruptModelMessages(input: {
  repo: RepositoryReader;
  organizationId: string;
  threadId: string;
  agentId: string;
  cursor: MessageCursor;
  runId?: string;
  limit?: number;
}): ModelMessage[] {
  const page = filterVisibleMessages(
    input.repo.listMessages(
      input.organizationId,
      input.threadId,
      input.cursor.createdAt ? encodeCursor(input.cursor.createdAt, input.cursor.id) : undefined,
      input.limit ?? 100,
    ).data,
  );
  const interrupts = collectInterruptMessages(page, input.cursor, input.agentId);
  if (input.runId) recordRunInterruptCursor(input.runId, input.cursor);
  return toModelMessages(interrupts, input.agentId);
}

export function loadChannelInterruptModelMessages(input: {
  repo: RepositoryReader & {
    listChannelMessages(
      organizationId: string,
      channelId: string,
      options?: { cursor?: string; limit?: number },
    ): { data: Message[] };
  };
  organizationId: string;
  channelId: string;
  agentId: string;
  cursor: MessageCursor;
  runId?: string;
  limit?: number;
}): ModelMessage[] {
  const page = filterVisibleMessages(
    input.repo.listChannelMessages(input.organizationId, input.channelId, {
      cursor: input.cursor.createdAt ? encodeCursor(input.cursor.createdAt, input.cursor.id) : undefined,
      limit: input.limit ?? 100,
    }).data,
  );
  const interrupts = collectInterruptMessages(page, input.cursor, input.agentId);
  if (input.runId) recordRunInterruptCursor(input.runId, input.cursor);
  return toModelMessages(interrupts, input.agentId);
}

export { createMessageCursor };
