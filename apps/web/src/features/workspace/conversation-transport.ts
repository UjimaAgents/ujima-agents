import type { BootstrapResponse } from "@ujima/api-schema";
import type { WsFrame } from "@ujima/api-schema";
import type { SocketEventName } from "@ujima/shared";
import type { SelectedConversation } from "./types";

export interface ConversationTransport {
  organizationId: string;
  threadId: string;
  recipientId?: string;
  channelIds: string[];
  threadIds: string[];
  memberIds: string[];
}

export type ConversationStreamEnvelope =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "frame"; frame: WsFrame }
  | { type: "socket"; event: SocketEventName; payload: unknown };

export function getDirectMessageThreadId(senderId: string, recipientId: string): string {
  const [firstId, secondId] = [senderId, recipientId].sort();
  return `dm:${firstId}:${secondId}`;
}

export function buildConversationStreamParams(transport: ConversationTransport): URLSearchParams {
  const params = new URLSearchParams({
    organizationId: transport.organizationId,
    threadId: transport.threadId,
  });
  for (const channelId of transport.channelIds) {
    params.append("channelIds", channelId);
  }
  for (const memberId of transport.memberIds) {
    params.append("memberIds", memberId);
  }
  for (const threadId of transport.threadIds) {
    params.append("threadIds", threadId);
  }
  return params;
}

export function buildConversationMessagePayload(
  transport: ConversationTransport,
  conversationType: SelectedConversation["type"],
  conversationId: string,
  senderId: string,
  content: string,
  parentMessageId?: string,
):
  | {
      organizationId: string;
      senderId: string;
      recipientId: string;
      content: string;
      parentMessageId?: string;
    }
  | {
      organizationId: string;
      senderId: string;
      threadId: string;
      channelId?: string;
      content: string;
      parentMessageId?: string;
    } {
  if (transport.recipientId) {
    return {
      organizationId: transport.organizationId,
      senderId,
      recipientId: transport.recipientId,
      content,
      parentMessageId,
    };
  }

  return {
    organizationId: transport.organizationId,
    senderId,
    threadId: transport.threadId,
    channelId: conversationType === "channel" ? conversationId : undefined,
    content,
    parentMessageId,
  };
}

export function resolveConversationTransport(
  bootstrap: BootstrapResponse,
  conversation: SelectedConversation,
): ConversationTransport | null {
  const organizationId = bootstrap.organization?.id;
  const senderId = bootstrap.auth.member?.id;
  if (!organizationId || !senderId) return null;

  if (conversation.type === "channel") {
    return {
      organizationId,
      threadId: conversation.id,
      channelIds: [conversation.id],
      threadIds: [conversation.id],
      memberIds: [],
    };
  }

  const threadId = getDirectMessageThreadId(senderId, conversation.id);
  return {
    organizationId,
    threadId,
    recipientId: conversation.id,
    channelIds: [threadId],
    threadIds: [threadId],
    memberIds: [senderId, conversation.id],
  };
}
