import type { SocketEventName } from '@ujima/shared';
import type { RepositoryReader } from './repository-reader.js';
import type { TeamStore } from './team-store.js';

export interface ApiServiceContext {
  teamStore: TeamStore;
  repo: RepositoryReader;
  realtime: RealtimeService;
}

export interface RealtimeService {
  emit<T extends SocketEventName>(
    event: T,
    payload: { organizationId: string } & Record<string, unknown>,
    targetRooms?: string[],
  ): void;
}
