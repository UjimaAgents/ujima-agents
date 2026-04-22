import type { AgentStateStore } from '@ujima/context-store';

export interface WatchdogOptions {
  agentState: AgentStateStore;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onTimeout: (agentId: string, lastHeartbeat: number | undefined) => void | Promise<void>;
  now?: () => number;
}

export interface AgentWatchdog {
  start(): void;
  stop(): void;
  readonly watching: Set<string>;
}

export function createAgentWatchdog(options: WatchdogOptions): AgentWatchdog {
  const { agentState, timeoutMs = 60_000, pollIntervalMs = 5_000, onTimeout, now = () => Date.now() } = options;
  const watching = new Set<string>();
  const tripped = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  async function tick(): Promise<void> {
    const list = await agentState.list();
    const cutoff = now() - timeoutMs;
    for (const record of list) {
      if (record.status === 'exited' || record.status === 'killed') {
        tripped.delete(record.agent_id);
        continue;
      }
      watching.add(record.agent_id);
      if (tripped.has(record.agent_id)) continue;
      const last = record.last_heartbeat ?? record.updated_at;
      if (last < cutoff) {
        tripped.add(record.agent_id);
        await onTimeout(record.agent_id, record.last_heartbeat);
      }
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, pollIntervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    watching,
  };
}
