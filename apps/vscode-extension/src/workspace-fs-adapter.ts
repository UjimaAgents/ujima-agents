import * as vscode from 'vscode';
import type { WorkspaceFS, DirEntry, FileKind } from '@ujima/runtime-core';

export function createVscodeWorkspaceFS(): WorkspaceFS {
  const fs = vscode.workspace.fs;
  return {
    async readFile(absPath) {
      return fs.readFile(vscode.Uri.file(absPath));
    },
    async writeFile(absPath, bytes) {
      const uri = vscode.Uri.file(absPath);
      const dirUri = vscode.Uri.file(dirname(absPath));
      try {
        await fs.createDirectory(dirUri);
      } catch {
        // parent may already exist
      }
      await fs.writeFile(uri, bytes);
    },
    async readDirectory(absPath) {
      const entries = await fs.readDirectory(vscode.Uri.file(absPath));
      return entries.map(([name, type]): DirEntry => ({ name, kind: mapKind(type) }));
    },
    async createDirectory(absPath) {
      await fs.createDirectory(vscode.Uri.file(absPath));
    },
    async stat(absPath) {
      try {
        const st = await fs.stat(vscode.Uri.file(absPath));
        return { kind: mapKind(st.type), size: st.size, mtimeMs: st.mtime };
      } catch (err) {
        if (isFileNotFound(err)) return undefined;
        throw err;
      }
    },
    async exists(absPath) {
      try {
        await fs.stat(vscode.Uri.file(absPath));
        return true;
      } catch (err) {
        if (isFileNotFound(err)) return false;
        throw err;
      }
    },
    async remove(absPath, opts) {
      await fs.delete(vscode.Uri.file(absPath), { recursive: opts?.recursive ?? false });
    },
  };
}

function mapKind(type: vscode.FileType): FileKind {
  if (type & vscode.FileType.SymbolicLink) return 'symlink';
  if (type & vscode.FileType.Directory) return 'directory';
  if (type & vscode.FileType.File) return 'file';
  return 'other';
}

function isFileNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; name?: string };
  return e.code === 'FileNotFound' || e.name === 'EntryNotFound (FileSystemError)';
}

function dirname(absPath: string): string {
  const idx = absPath.lastIndexOf('/');
  if (idx <= 0) return '/';
  return absPath.slice(0, idx);
}
