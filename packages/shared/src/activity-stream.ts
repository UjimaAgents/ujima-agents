export interface ActivityEvent {
  event_id: string;
  type: string;
  publisher: string;
  timestamp: string;
  task_id?: string;
  session_id?: string;
  payload?: unknown;
}

export interface ActivityFilter {
  agents?: string[];
  types?: string[];
  sinceMs?: number;
  search?: string;
}

export const EMPTY_ACTIVITY_FILTER: ActivityFilter = {
  agents: [],
  types: [],
};

export function filterActivity(events: ActivityEvent[], filter: ActivityFilter): ActivityEvent[] {
  const agents = filter.agents?.length ? new Set(filter.agents) : undefined;
  const types = filter.types?.length ? new Set(filter.types) : undefined;
  const since = filter.sinceMs;
  const search = filter.search?.trim().toLowerCase();

  return events.filter((e) => {
    if (agents && !agents.has(e.publisher)) return false;
    if (types && !types.has(e.type)) return false;
    if (since !== undefined) {
      const ts = Date.parse(e.timestamp);
      if (Number.isNaN(ts) || ts < since) return false;
    }
    if (search) {
      const hay = [
        e.event_id,
        e.type,
        e.publisher,
        e.task_id ?? '',
        e.session_id ?? '',
        safeStringify(e.payload),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export function uniqueAgents(events: ActivityEvent[]): string[] {
  return [...new Set(events.map((e) => e.publisher))].sort();
}

export function uniqueTypes(events: ActivityEvent[]): string[] {
  return [...new Set(events.map((e) => e.type))].sort();
}

export interface AppendOptions {
  max?: number;
}

export function appendEvents(
  current: ActivityEvent[],
  incoming: ActivityEvent[],
  options: AppendOptions = {},
): ActivityEvent[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((e) => e.event_id));
  const merged = current.slice();
  for (const e of incoming) {
    if (seen.has(e.event_id)) continue;
    seen.add(e.event_id);
    merged.push(e);
  }
  merged.sort((a, b) => {
    const at = Date.parse(a.timestamp);
    const bt = Date.parse(b.timestamp);
    if (Number.isNaN(at) || Number.isNaN(bt)) return 0;
    return at - bt;
  });
  const max = options.max;
  if (max !== undefined && merged.length > max) {
    return merged.slice(merged.length - max);
  }
  return merged;
}

function safeStringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
