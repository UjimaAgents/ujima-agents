import type { BootstrapResponse } from "@ujima/api-schema";
import type { WsFrame } from "@ujima/api-schema";
import type { SocketEventName } from "@ujima/shared";
import type { SelectedConversation } from "./types";

export interface ConversationTransport {
  organizationId: string;
  threadId: string;
  recipientId?: string;
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
      threadIds: [conversation.id],
      memberIds: [],
    };
  }

  const threadId = getDirectMessageThreadId(senderId, conversation.id);
  return {
    organizationId,
    threadId,
    recipientId: conversation.id,
    threadIds: [threadId],
    memberIds: [senderId, conversation.id],
  };
}
