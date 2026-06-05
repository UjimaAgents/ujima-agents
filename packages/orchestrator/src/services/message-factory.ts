import { randomUUID } from 'node:crypto';
import {
  AGENT_KIND,
  MessageSchema,
  type Message,
  type MessageToolCall,
} from '@ujima/shared';

interface MessageDraft {
  id?: string;
  organizationId: string;
  threadId: string;
  channelId?: string;
  parentMessageId?: string;
  senderId: string;
  senderKind: Message['senderKind'];
  kind: Message['kind'];
  content: string;
  mentions?: string[];
  mentionNames?: string[];
  toolCalls?: MessageToolCall[];
  attachments?: Message['attachments'];
  metadata?: Message['metadata'];
  clientMessageId?: string;
  reasoningContent?: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAt?: string;
  editedAt?: string;
  deletedAt?: string;
}

export function buildMessage(input: MessageDraft): Message {
  return MessageSchema.parse({
    id: input.id ?? randomUUID(),
    organizationId: input.organizationId,
    threadId: input.threadId,
    ...(input.channelId ? { channelId: input.channelId } : {}),
    ...(input.parentMessageId ? { parentMessageId: input.parentMessageId } : {}),
    senderId: input.senderId,
    senderKind: input.senderKind,
    kind: input.kind,
    content: input.content,
    ...(input.reasoningContent ? { reasoningContent: input.reasoningContent } : {}),
    ...(input.mentions !== undefined ? { mentions: input.mentions } : {}),
    ...(input.mentionNames !== undefined ? { mentionNames: input.mentionNames } : {}),
    ...(input.toolCalls !== undefined ? { toolCalls: input.toolCalls } : {}),
    ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    ...(input.inputTokens !== undefined ? { inputTokens: input.inputTokens } : {}),
    ...(input.outputTokens !== undefined ? { outputTokens: input.outputTokens } : {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.editedAt ? { editedAt: input.editedAt } : {}),
    ...(input.deletedAt ? { deletedAt: input.deletedAt } : {}),
  });
}

export function buildAgentMessage(
  input: Omit<MessageDraft, 'senderKind' | 'kind'> & {
    senderKind?: typeof AGENT_KIND;
    kind?: typeof AGENT_KIND;
  },
): Message {
  return buildMessage({
    ...input,
    senderKind: AGENT_KIND,
    kind: AGENT_KIND,
  });
}

export function buildSystemMessage(
  input: Omit<MessageDraft, 'senderId' | 'senderKind' | 'kind'> & {
    senderId?: string;
  },
): Message {
  return buildMessage({
    ...input,
    senderId: input.senderId ?? 'system',
    senderKind: 'human',
    kind: 'system',
  });
}

export function buildArtifactMessage(input: {
  organizationId: string;
  threadId: string;
  channelId?: string | null;
  senderId: string;
  content: string;
  artifactFileToolCall: MessageToolCall;
  runId?: string;
}): Message {
  return buildAgentMessage({
    organizationId: input.organizationId,
    threadId: input.threadId,
    channelId: input.channelId ?? undefined,
    senderId: input.senderId,
    content: input.content,
    metadata: input.runId ? { runId: input.runId } : {},
    toolCalls: [input.artifactFileToolCall],
  });
}
