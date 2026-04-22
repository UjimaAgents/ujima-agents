import { EventEmitter } from 'node:events';
import type { UjimaEvent } from '@ujima/shared';
import type { AuditLog, PendingEventStore } from '@ujima/context-store';

export interface EventBus {
  publish<T>(channel: string, event: UjimaEvent<T>): Promise<void>;
  subscribe<T>(
    channel: string,
    handler: (event: UjimaEvent<T>) => void | Promise<void>,
    options?: SubscribeOptions,
  ): () => void;
  replay<T>(channel: string, sinceMs: number): Promise<UjimaEvent<T>[]>;
  close(): Promise<void>;
}

export interface SubscribeOptions {
  replaySinceMs?: number;
}

export interface CreateEventBusOptions {
  audit?: AuditLog;
  pendingEvents?: PendingEventStore;
  replayTtlMs?: number;
}

export function createLocalEventBus(options: CreateEventBusOptions = {}): EventBus {
  const { audit, pendingEvents, replayTtlMs } = options;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(500);

  return {
    async publish(channel, event) {
      if (audit) {
        await audit.write({
          event_id: event.event_id,
          event_type: 'event_published',
          agent_id: event.publisher,
          task_id: event.task_id ?? 'unknown',
          session_id: event.session_id ?? 'unknown',
          allowed: true,
          tool_input: { channel, type: event.type },
        });
      }
      if (pendingEvents) {
        await pendingEvents.add(channel, event as UjimaEvent, replayTtlMs);
      }
      emitter.emit(channel, event);
    },

    subscribe(channel, handler, opts) {
      const wrapped = (event: UjimaEvent<unknown>): void => {
        try {
          const maybe = handler(event as UjimaEvent<never>);
          if (maybe && typeof (maybe as Promise<void>).then === 'function') {
            (maybe as Promise<void>).catch(() => {
              // handler errors are isolated — do not cascade to other subscribers
            });
          }
        } catch {
          // handler threw synchronously — swallow so other subscribers still receive
        }
      };
      emitter.on(channel, wrapped);

      if (opts?.replaySinceMs !== undefined && pendingEvents) {
        void pendingEvents.listSince(channel, opts.replaySinceMs).then((records) => {
          for (const r of records) {
            void handler(r.event as UjimaEvent<never>);
          }
        });
      }

      return () => emitter.off(channel, wrapped);
    },

    async replay<T>(channel: string, sinceMs: number): Promise<UjimaEvent<T>[]> {
      if (!pendingEvents) return [];
      const records = await pendingEvents.listSince(channel, sinceMs);
      return records.map((r) => r.event as UjimaEvent<T>);
    },

    async close() {
      emitter.removeAllListeners();
    },
  };
}
