import { describe, expect, it } from 'vitest';
import { ChannelSchema, type Channel } from '@ujima/shared';
import { resolveVisiblePromptChannels } from './visible-prompt-channels.js';

function buildChannel(overrides: Partial<Channel>): Channel {
  return ChannelSchema.parse({
    id: overrides.id ?? overrides.name ?? 'general',
    name: overrides.name ?? overrides.id ?? 'general',
    kind: 'general',
    ...overrides,
  });
}

function repoOf(channels: Channel[]) {
  return { listAllChannels: () => channels };
}

describe('resolveVisiblePromptChannels', () => {
  it('returns the input unchanged when the runtime DB has no channels at all (bootstrap)', () => {
    // Pre-sync: team config defines handles but config-sync has not
    // yet written them to the DB. The agent still needs to see them.
    const handles = [buildChannel({ id: 'general', name: 'general' })];
    const out = resolveVisiblePromptChannels(handles, repoOf([]), 'org-1');
    expect(out).toEqual(handles);
  });

  it('rebinds a handle to the live runtime channel when their ids match', () => {
    const live = buildChannel({ id: 'chan-1', name: 'general', topic: 'live topic' });
    const handles = [buildChannel({ id: 'chan-1', name: 'general', topic: 'stale topic' })];
    const out = resolveVisiblePromptChannels(handles, repoOf([live]), 'org-1');
    expect(out).toHaveLength(1);
    // Prompt should see the current runtime topic, not the stale config copy.
    expect(out[0]?.topic).toBe('live topic');
  });

  it('drops a handle whose id matches an archived runtime channel', () => {
    const archived = buildChannel({
      id: 'chan-1',
      name: 'general',
      archivedAt: '2026-01-01T00:00:00.000Z',
    });
    const handles = [buildChannel({ id: 'chan-1', name: 'general' })];
    const out = resolveVisiblePromptChannels(handles, repoOf([archived]), 'org-1');
    expect(out).toEqual([]);
  });

  it('drops a name handle when the only runtime channel with that name is archived', () => {
    // `normalizeChannels` lets `channels: ['general']` produce a Channel
    // with `id = name = "general"`. When the matching runtime row was
    // archived, the agent must not see a dead handle.
    const archived = buildChannel({
      id: 'chan-1',
      name: 'general',
      archivedAt: '2026-01-01T00:00:00.000Z',
    });
    const handles = [buildChannel({ id: 'general', name: 'general' })];
    const out = resolveVisiblePromptChannels(handles, repoOf([archived]), 'org-1');
    expect(out).toEqual([]);
  });

  it('resolves a name handle to the live runtime channel when their names match (real id, not synthetic)', () => {
    // The original bug: a name handle `{id: "general", name: "general"}`
    // collided with an archived "general" and silently hid the live
    // replacement. Now the handle resolves to the live channel so
    // `channel.read` on the prompt-emitted id actually works.
    const archived = buildChannel({
      id: 'chan-1',
      name: 'general',
      archivedAt: '2026-01-01T00:00:00.000Z',
    });
    const live = buildChannel({ id: 'chan-2', name: 'general' });
    const handles = [buildChannel({ id: 'general', name: 'general' })];
    const out = resolveVisiblePromptChannels(handles, repoOf([archived, live]), 'org-1');
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('chan-2');
  });

  it('drops a name handle when multiple live channels share that name (ambiguous)', () => {
    // Schema does not enforce name uniqueness. If two live channels
    // share a name, binding the handle to either one is a 50/50
    // guess. Dropping is safer than silently wrong.
    const liveA = buildChannel({ id: 'chan-1', name: 'general' });
    const liveB = buildChannel({ id: 'chan-2', name: 'general' });
    const handles = [buildChannel({ id: 'general', name: 'general' })];
    const out = resolveVisiblePromptChannels(handles, repoOf([liveA, liveB]), 'org-1');
    expect(out).toEqual([]);
  });

  it('drops the archived handle while preserving an unrelated live handle in the same input', () => {
    const archived = buildChannel({
      id: 'chan-1',
      name: 'old-channel',
      archivedAt: '2026-01-01T00:00:00.000Z',
    });
    const live = buildChannel({ id: 'chan-2', name: 'general' });
    const handles = [
      buildChannel({ id: 'chan-1', name: 'old-channel' }),
      buildChannel({ id: 'chan-2', name: 'general' }),
    ];
    const out = resolveVisiblePromptChannels(handles, repoOf([archived, live]), 'org-1');
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('chan-2');
  });

  it('deduplicates when multiple handles resolve to the same runtime channel', () => {
    // Two different config entries (a real id and a name handle) both
    // point at the same live channel — emit it once.
    const live = buildChannel({ id: 'chan-1', name: 'general' });
    const handles = [
      buildChannel({ id: 'chan-1', name: 'general' }),
      buildChannel({ id: 'general', name: 'general' }),
    ];
    const out = resolveVisiblePromptChannels(handles, repoOf([live]), 'org-1');
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('chan-1');
  });

  it('passes a handle through when the runtime has no channels with that name (handle is new, not archived)', () => {
    // No archived row, no live row — config-sync just hasn't seen
    // this channel yet. Pass through so the agent can reference it.
    const unrelatedLive = buildChannel({ id: 'chan-2', name: 'design' });
    const handles = [buildChannel({ id: 'general', name: 'general' })];
    const out = resolveVisiblePromptChannels(handles, repoOf([unrelatedLive]), 'org-1');
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('general');
  });
});
