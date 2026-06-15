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

});
