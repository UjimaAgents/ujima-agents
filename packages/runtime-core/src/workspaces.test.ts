import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { openDatabase } from '@ujima/context-store';
import { createWorkspaceStore, NoWorkspaceRootError, syncWorkspacesFromOrganizations } from './workspaces';

describe('WorkspaceStore', () => {
  let store: ReturnType<typeof createWorkspaceStore>;

  beforeEach(() => {
    const db = openDatabase({ dbPath: ':memory:' });
    store = createWorkspaceStore(db);
  });

  it('creates, reads, updates, removes workspaces', () => {
    const ws = store.create({ root_path: '/tmp/foo', label: 'foo' });
    expect(ws.id).toBeTruthy();
    expect(store.get(ws.id)?.label).toBe('foo');
    expect(store.findByRoot('/tmp/foo')?.id).toBe(ws.id);

    const updated = store.update(ws.id, { label: 'renamed' });
    expect(updated.label).toBe('renamed');

    expect(store.remove(ws.id)).toBe(true);
    expect(store.get(ws.id)).toBeUndefined();
  });

  it('list returns rows in creation order', () => {
    const a = store.create({ label: 'a' });
    const b = store.create({ label: 'b' });
    const ids = store.list().map((w) => w.id);
    expect(ids).toEqual([a.id, b.id]);
  });

  it('requireReady throws NoWorkspaceRootError when workspace is missing', () => {
    expect(() => store.requireReady('missing')).toThrow(NoWorkspaceRootError);
  });

  it('requireReady throws NoWorkspaceRootError when root_path is empty', () => {
    const ws = store.create({ root_path: null });
    expect(() => store.requireReady(ws.id)).toThrow(NoWorkspaceRootError);
  });

  it('requireReady returns workspace when root_path is set', () => {
    const ws = store.create({ root_path: '/tmp/x' });
    expect(store.requireReady(ws.id).id).toBe(ws.id);
  });

  it('syncWorkspacesFromOrganizations creates a row for each org root', () => {
    const root = resolve('/tmp/acme');
    syncWorkspacesFromOrganizations(store, [
      {
        id: 'org-1',
        name: 'Acme',
        workspace: { root },
      },
    ]);
    const synced = store.findByRoot(root);
    expect(synced?.label).toBe('Acme');
    expect(synced?.id).toBe('ws_org-1');

    syncWorkspacesFromOrganizations(store, [
      {
        id: 'org-1',
        name: 'Acme',
        workspace: { root },
      },
    ]);
    expect(store.list()).toHaveLength(1);
  });
});
