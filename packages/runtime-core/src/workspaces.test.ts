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

  it('requireReady throws NoWorkspaceRootError when workspace is missing', () => {
    expect(() => store.requireReady('missing')).toThrow(NoWorkspaceRootError);
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
