import { describe, expect, it } from 'vitest';
import { cursorWhereClause, decodeCursor, encodeCursor } from './cursor.js';

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a (timestamp, id) pair', () => {
    const cursor = encodeCursor('2026-04-27T08:00:00.000Z', 'msg_123');
    expect(decodeCursor(cursor)).toEqual({
      timestamp: '2026-04-27T08:00:00.000Z',
      id: 'msg_123',
    });
  });

  it('treats undefined input as undefined', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it('parses a legacy single-column cursor (no pipe) for backward compat', () => {
    expect(decodeCursor('2026-04-27T08:00:00.000Z')).toEqual({
      timestamp: '2026-04-27T08:00:00.000Z',
      id: undefined,
    });
  });

  it('keeps everything after the first pipe in the id (uuids contain hyphens not pipes)', () => {
    const id = '5b1e6d7e-3a2c-4cdf-9d4f-2cca0b9c4e21';
    const cursor = encodeCursor('2026-04-27T08:00:00.000Z', id);
    expect(decodeCursor(cursor)?.id).toBe(id);
  });

  it('round-trips ids that themselves contain pipes', () => {
    const id = 'ops|infra';
    const cursor = encodeCursor('2026-04-27T08:00:00.000Z', id);
    expect(decodeCursor(cursor)).toEqual({
      timestamp: '2026-04-27T08:00:00.000Z',
      id,
    });
  });
});

describe('cursorWhereClause', () => {
  it('emits a composite predicate when both timestamp and id are present', () => {
    const result = cursorWhereClause(
      { timestamp: '2026-04-27T08:00:00.000Z', id: 'msg_42' },
      'created_at',
      'id',
    );
    expect(result.sql).toBe('(created_at < ? OR (created_at = ? AND id < ?))');
    expect(result.params).toEqual([
      '2026-04-27T08:00:00.000Z',
      '2026-04-27T08:00:00.000Z',
      'msg_42',
    ]);
  });

  it('falls back to a single-column predicate when given a legacy cursor', () => {
    const result = cursorWhereClause(
      { timestamp: '2026-04-27T08:00:00.000Z', id: undefined },
      'created_at',
      'id',
    );
    expect(result.sql).toBe('created_at < ?');
    expect(result.params).toEqual(['2026-04-27T08:00:00.000Z']);
  });

  it('honours the column-name overrides (e.g. `m.created_at`, `started_at`)', () => {
    const composite = cursorWhereClause(
      { timestamp: 't', id: 'i' },
      'm.created_at',
      'm.id',
    );
    expect(composite.sql).toBe('(m.created_at < ? OR (m.created_at = ? AND m.id < ?))');

    const single = cursorWhereClause(
      { timestamp: 't', id: undefined },
      'started_at',
      'id',
    );
    expect(single.sql).toBe('started_at < ?');
  });
});
