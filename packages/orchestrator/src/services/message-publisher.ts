import {
  SocketEventNames,
  channelRoom,
  orgRoom,
  threadRoom,
  type Message,
} from '@ujima/shared';
import type { ConversationService } from './conversation.js';
import type { RealtimeService } from './context.js';
import type { ApiRepository } from './repository-reader.js';

export function publishStoredMessage(input: {
  repo?: ApiRepository;
  realtime?: RealtimeService;
  conversations?: ConversationService;
  message: Message;
}): Message {
  if (input.conversations) {
    return input.conversations.publishMessage(input.message, []);
  }
  if (!input.repo || !input.realtime) {
    throw new Error('publishStoredMessage requires repo and realtime when conversations is absent');
  }

  const saved = input.repo.saveMessage(input.message);
  input.realtime.emit(
    saved.channelId ? SocketEventNames.channelMessage : SocketEventNames.threadMessage,
    saved.channelId
      ? {
          organizationId: saved.organizationId,
          channelId: saved.channelId,
          message: saved,
        }
      : {
          organizationId: saved.organizationId,
          threadId: saved.threadId,
          message: saved,
        },
    saved.channelId
      ? [orgRoom(saved.organizationId), channelRoom(saved.channelId)]
      : [orgRoom(saved.organizationId), threadRoom(saved.threadId)],
  );
  return saved;
}
