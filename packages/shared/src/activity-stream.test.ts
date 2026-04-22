import { describe, expect, it } from 'vitest';
import {
  appendEvents,
  filterActivity,
  uniqueAgents,
  uniqueTypes,
  type ActivityEvent,
} from './activity-stream';

const mk = (
  id: string,
  publisher: string,
  type: string,
  tsOffsetMs: number,
  payload: unknown = {},
): ActivityEvent => ({
  event_id: id,
  type,
  publisher,
  timestamp: new Date(1_700_000_000_000 + tsOffsetMs).toISOString(),
  task_id: 'task_1',
  session_id: 'sess_1',
  payload,
});

describe('activity-stream filter', () => {
  const events: ActivityEvent[] = [
    mk('e1', 'sr-designer', 'agent_started', 0),
    mk('e2', 'jr-designer', 'tool_call', 1_000, { tool: 'create_frame' }),
    mk('e3', 'sr-designer', 'agent_exited', 2_000),
    mk('e4', 'orchestrator', 'approval_requested', 3_000, { approval_id: 'ap_1' }),
  ];

  it('returns all events on empty filter', () => {
    expect(filterActivity(events, {})).toEqual(events);
    expect(filterActivity(events, { agents: [], types: [] })).toEqual(events);
  });

  it('filters by publisher (agent)', () => {
    const hits = filterActivity(events, { agents: ['sr-designer'] });
    expect(hits.map((e) => e.event_id)).toEqual(['e1', 'e3']);
  });

  it('filters by event type', () => {
    const hits = filterActivity(events, { types: ['tool_call', 'approval_requested'] });
    expect(hits.map((e) => e.event_id)).toEqual(['e2', 'e4']);
  });

  it('filters by sinceMs', () => {
    const hits = filterActivity(events, { sinceMs: 1_700_000_001_500 });
    expect(hits.map((e) => e.event_id)).toEqual(['e3', 'e4']);
  });

  it('filters by free-text search (payload JSON included)', () => {
    const hits = filterActivity(events, { search: 'create_frame' });
    expect(hits.map((e) => e.event_id)).toEqual(['e2']);
  });

  it('combines agent + type + search', () => {
    const hits = filterActivity(events, {
      agents: ['jr-designer'],
      types: ['tool_call'],
      search: 'create',
    });
    expect(hits.map((e) => e.event_id)).toEqual(['e2']);
  });

  it('uniqueAgents / uniqueTypes populate filter dropdowns', () => {
    expect(uniqueAgents(events)).toEqual(['jr-designer', 'orchestrator', 'sr-designer']);
    expect(uniqueTypes(events)).toEqual([
      'agent_exited',
      'agent_started',
      'approval_requested',
      'tool_call',
    ]);
  });
});

describe('activity-stream append', () => {
  it('dedupes on event_id and sorts by timestamp', () => {
    const a = [
      { event_id: 'e1', type: 't', publisher: 'p', timestamp: new Date(1000).toISOString() },
      { event_id: 'e3', type: 't', publisher: 'p', timestamp: new Date(3000).toISOString() },
    ];
    const b = [
      { event_id: 'e2', type: 't', publisher: 'p', timestamp: new Date(2000).toISOString() },
      { event_id: 'e1', type: 't', publisher: 'p', timestamp: new Date(1000).toISOString() },
    ];
    const merged = appendEvents(a, b);
    expect(merged.map((e) => e.event_id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('trims to max keeping most recent', () => {
    const base: ActivityEvent[] = Array.from({ length: 5 }, (_, i) =>
      mk(`e${i}`, 'p', 't', i * 1_000),
    );
    const trimmed = appendEvents([], base, { max: 3 });
    expect(trimmed.map((e) => e.event_id)).toEqual(['e2', 'e3', 'e4']);
  });

  it('no-op when incoming is empty', () => {
    const current = [mk('e1', 'p', 't', 0)];
    expect(appendEvents(current, [])).toBe(current);
  });
});
