import {
  SocketEventNames,
  SpiritSchema,
  memberRoom,
  orgRoom,
  runRoom,
  threadRoom,
  type RunState,
  type Spirit,
} from '@ujima/shared';
import type { ActiveSpiritRegistry } from './active-spirit-registry.js';
import type { RealtimeService } from './context.js';
import type { SpiritRunState } from './spirit-run-state.js';
import type { TeamStore } from './team-store.js';
import type { RunStore, MemberStore } from './repository-reader.js';

/**
 * Narrow contract for spirit + run persistence.
 *
 * Handles:
 * - Spirit spawn, save (terminal, waiting, running)
 * - Run state updates and realtime emit
 * - Task session finalization
 */
export interface RunStatePersisterDeps {
  runs: RunStore;
  members: MemberStore;
  realtime: RealtimeService;
  registry: ActiveSpiritRegistry;
  teamStore: TeamStore;
}

export class RunStatePersister {
  constructor(private readonly deps: RunStatePersisterDeps) {}

  spawn(input: {
    organizationId: string;
    taskSessionId: string;
    memberId: string;
    role: string;
    runId?: string | null;
  }): Spirit {
    const spirit = SpiritSchema.parse({
      ...input,
      id: input.runId ?? crypto.randomUUID(),
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return spirit;
  }

  saveRunning(spirit: Spirit): Spirit {
    const running = SpiritSchema.parse({
      ...spirit,
      status: 'running' as const,
      updatedAt: new Date().toISOString(),
    });
    this.deps.members.saveSpirit(running);
    this.deps.registry.register(running);
    return running;
  }

  saveTerminal(runState: SpiritRunState, running: Spirit): Spirit {
    const spirit = {
      ...runState.applyToSpirit(running),
      updatedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    } as Spirit;
    this.deps.members.saveSpirit(spirit);
    this.deps.registry.unregister(spirit.organizationId, spirit.memberId, spirit.id);
    return spirit;
  }

  saveWaiting(runState: SpiritRunState, running: Spirit): Spirit {
    const spirit = {
      ...runState.applyToSpirit(running),
      updatedAt: new Date().toISOString(),
    } as Spirit;
    this.deps.members.saveSpirit(spirit);
    return spirit;
  }

  saveRunAndEmit(run: RunState): void {
    this.deps.runs.saveRun(run);
    this.deps.realtime.emit(
      SocketEventNames.runUpdated,
      { organizationId: run.organizationId, run },
      this.getRooms(run),
    );
  }

  emitRunCompleted(organizationId: string, run: RunState): void {
    this.deps.realtime.emit(
      SocketEventNames.runCompleted,
      { organizationId, run },
      this.getRooms(run),
    );
  }

  emitSpiritUpdated(spirit: Spirit): void {
    this.deps.realtime.emit(
      SocketEventNames.spiritUpdated,
      spirit,
      [], // Emit to all org members
    );
  }

  emitSpiritCompleted(spirit: Spirit): void {
    this.deps.realtime.emit(
      SocketEventNames.spiritCompleted,
      spirit,
      [], // Emit to all org members
    );
  }

  // maybeFinalizeTaskSession is handled by the callers directly
  // via the SpiritServiceBase method.

  updateRunRow(run: RunState): void {
    this.deps.runs.saveRun(run);
  }

  getRun(organizationId: string, runId: string): RunState | null {
    return this.deps.runs.getRun(organizationId, runId);
  }

  private getRooms(run: RunState): string[] {
    const rooms = [orgRoom(run.organizationId), memberRoom(run.agentId), runRoom(run.id)];
    if (run.threadId) {
      rooms.push(threadRoom(run.threadId));
    }
    return rooms;
  }
}
