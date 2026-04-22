import { describe, expect, it } from 'vitest';
import { setAgentRule } from '@ujima/shared';
import { createWorkspacePolicyStore, type WorkspacePolicyAdapter } from './workspace-policy.js';

function memoryAdapter(initial?: Uint8Array): WorkspacePolicyAdapter & {
  bytes: () => Uint8Array | undefined;
  writes: number;
} {
  let bytes = initial;
  let writes = 0;
  const adapter: WorkspacePolicyAdapter & {
    bytes: () => Uint8Array | undefined;
    writes: number;
  } = {
    async read() {
      return bytes;
    },
    async write(b) {
      writes++;
      adapter.writes = writes;
      bytes = b;
    },
    bytes: () => bytes,
    writes,
  };
  return adapter;
}

describe('workspace policy store', () => {
  it('load() returns an empty policy when the file does not exist', async () => {
    const store = createWorkspacePolicyStore(memoryAdapter());
    const p = await store.load();
    expect(p.version).toBe(1);
    expect(Object.keys(p.agents)).toHaveLength(0);
  });

  it('load() falls back to empty policy on malformed JSON without throwing', async () => {
    const store = createWorkspacePolicyStore(
      memoryAdapter(new TextEncoder().encode('not json')),
    );
    const p = await store.load();
    expect(p.agents).toEqual({});
  });

  it('save() round-trips through the adapter with a trailing newline', async () => {
    const adapter = memoryAdapter();
    const store = createWorkspacePolicyStore(adapter);
    const base = await store.load();
    const next = setAgentRule(base, 'a1', {
      mcp_id: 'fs',
      tool_name: 'read',
      state: 'allow',
    });
    const saved = await store.save(next);
    expect(saved.agents['a1']).toHaveLength(1);
    expect(saved.updated_at).toBeDefined();
    const bytes = adapter.bytes();
    expect(bytes).toBeDefined();
    const raw = new TextDecoder().decode(bytes ?? new Uint8Array());
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw).agents.a1[0].state).toBe('allow');
  });

  it('mutate() applies a pure transform and persists', async () => {
    const adapter = memoryAdapter();
    const store = createWorkspacePolicyStore(adapter);
    await store.load();
    const next = await store.mutate((p) =>
      setAgentRule(p, 'a1', { mcp_id: 'fs', tool_name: 'write', state: 'deny' }),
    );
    expect(next.agents['a1']?.[0]?.state).toBe('deny');
    expect(adapter.writes).toBe(1);
    expect(store.current().agents['a1']?.[0]?.state).toBe('deny');
  });

  it('onChange fires on load and save', async () => {
    const store = createWorkspacePolicyStore(memoryAdapter());
    const events: string[] = [];
    const off = store.onChange((p) => events.push(p.updated_at ?? 'no-ts'));
    await store.load();
    await store.save(
      setAgentRule(store.current(), 'a1', {
        mcp_id: 'fs',
        tool_name: 'read',
        state: 'allow',
      }),
    );
    expect(events).toHaveLength(2);
    off();
    await store.save(store.current());
    expect(events).toHaveLength(2);
  });

  it('current() returns the in-memory cached policy between loads', async () => {
    const adapter = memoryAdapter();
    const store = createWorkspacePolicyStore(adapter);
    await store.load();
    const saved = await store.save(
      setAgentRule(store.current(), 'a1', {
        mcp_id: 'fs',
        tool_name: 'read',
        state: 'allow',
      }),
    );
    expect(store.current()).toEqual(saved);
  });
});
