import * as vscode from 'vscode';
import {
  createWorkspacePolicyStore,
  type WorkspacePolicyAdapter,
  type WorkspacePolicyStore,
} from '@ujima/permissions';

export interface GovernancePolicyBinding extends vscode.Disposable {
  store: WorkspacePolicyStore;
  uri: vscode.Uri;
}

/**
 * Binds `.ujima/governance.json` in the first workspace folder to a
 * `WorkspacePolicyStore`. Loads the file, watches it for external edits, and
 * cleans up its watcher when disposed.
 *
 * If the workspace has no folder, this returns `undefined` — callers should
 * treat that as "no workspace policy; skip governance enforcement."
 */
export async function bindGovernancePolicyStore(opts: {
  channel: vscode.OutputChannel;
}): Promise<GovernancePolicyBinding | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  const uri = vscode.Uri.joinPath(folder.uri, '.ujima', 'governance.json');

  const adapter: WorkspacePolicyAdapter = {
    async read() {
      try {
        return await vscode.workspace.fs.readFile(uri);
      } catch {
        return undefined;
      }
    },
    async write(bytes) {
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(folder.uri, '.ujima'),
      );
      await vscode.workspace.fs.writeFile(uri, bytes);
    },
  };

  const store = createWorkspacePolicyStore(adapter);
  await store.load();
  opts.channel.appendLine(
    `[governance-policy] loaded from ${uri.fsPath} (agents: ${Object.keys(store.current().agents).length})`,
  );

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, '.ujima/governance.json'),
  );
  let reloading = false;
  const reload = async (): Promise<void> => {
    if (reloading) return;
    reloading = true;
    try {
      await store.load();
      opts.channel.appendLine('[governance-policy] reloaded from disk');
    } finally {
      reloading = false;
    }
  };
  const subs: vscode.Disposable[] = [
    watcher,
    watcher.onDidChange(() => void reload()),
    watcher.onDidCreate(() => void reload()),
    watcher.onDidDelete(() => void reload()),
  ];

  return {
    store,
    uri,
    dispose() {
      for (const s of subs) s.dispose();
    },
  };
}
