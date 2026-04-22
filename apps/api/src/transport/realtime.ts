import {
  SocketEventSchemas,
  channelRoom,
  memberRoom,
  orgRoom,
  runRoom,
  threadRoom,
  type SocketEventName,
} from '@ujima/shared';
import { SocketSubscribeSchema } from '@ujima/api-schema';
import type { Repository } from '@ujima/runtime-core';
import type { Server, Socket } from 'socket.io';

export { channelRoom, memberRoom, orgRoom, runRoom, threadRoom };

export class RealtimeService {
  constructor(
    private readonly io: Server,
    private readonly repo: Repository,
  ) {
    this.io.on('connection', (socket: Socket) => {
      socket.on('subscribe', (raw) => {
        const payload = SocketSubscribeSchema.parse(raw);
        this.subscribe(socket, payload.organizationId, payload);
      });

      socket.on('unsubscribe', (raw) => {
        const payload = SocketSubscribeSchema.parse(raw);
        this.unsubscribe(socket, payload.organizationId, payload);
      });
    });
  }

  subscribe(
    socket: Socket,
    organizationId: string,
    rooms: {
      channelIds: string[];
      threadIds: string[];
      memberIds: string[];
      runIds: string[];
    },
  ) {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error(`Organization not found: ${organizationId}`);
    }

    socket.join(orgRoom(organizationId));

    for (const channelId of rooms.channelIds) {
      if (this.repo.getChannel(organizationId, channelId)) {
        socket.join(channelRoom(channelId));
      }
    }

    for (const threadId of rooms.threadIds) {
      if (this.repo.getThread(organizationId, threadId)) {
        socket.join(threadRoom(threadId));
      }
    }

    for (const memberId of rooms.memberIds) {
      if (this.repo.getMember(organizationId, memberId)) {
        socket.join(memberRoom(memberId));
      }
    }

    for (const runId of rooms.runIds) {
      if (this.repo.getRun(organizationId, runId)) {
        socket.join(runRoom(runId));
      }
    }
  }

  unsubscribe(
    socket: Socket,
    organizationId: string,
    rooms: {
      channelIds: string[];
      threadIds: string[];
      memberIds: string[];
      runIds: string[];
    },
  ) {
    socket.leave(orgRoom(organizationId));

    for (const channelId of rooms.channelIds) {
      socket.leave(channelRoom(channelId));
    }

    for (const threadId of rooms.threadIds) {
      socket.leave(threadRoom(threadId));
    }

    for (const memberId of rooms.memberIds) {
      socket.leave(memberRoom(memberId));
    }

    for (const runId of rooms.runIds) {
      socket.leave(runRoom(runId));
    }
  }

  emit<T extends SocketEventName>(
    event: T,
    payload: { organizationId: string } & Record<string, unknown>,
    targetRooms: string[] = [orgRoom(payload.organizationId)],
  ) {
    SocketEventSchemas[event].parse(payload);
    this.io.to(targetRooms).emit(event, payload);
  }
}
