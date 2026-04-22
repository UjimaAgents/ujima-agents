import { promises as fs } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import { join } from 'node:path';
import type { DirEntry, FileKind, WorkspaceFS } from './workspace-fs';

export function createNodeWorkspaceFS(): WorkspaceFS {
  return {
    async readFile(absPath) {
      const buf = await fs.readFile(absPath);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    async writeFile(absPath, bytes) {
      await fs.mkdir(dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, bytes);
    },
    async readDirectory(absPath): Promise<DirEntry[]> {
      const entries = await fs.readdir(absPath, { withFileTypes: true });
      return entries.map((e: Dirent) => ({ name: e.name, kind: direntKind(e) }));
    },
    async createDirectory(absPath) {
      await fs.mkdir(absPath, { recursive: true });
    },
    async stat(absPath) {
      try {
        const s = await fs.stat(absPath);
        return { kind: statKind(s), size: s.size, mtimeMs: s.mtimeMs };
      } catch (err) {
        if (isEnoent(err)) return undefined;
        throw err;
      }
    },
    async exists(absPath) {
      try {
        await fs.access(absPath);
        return true;
      } catch {
        return false;
      }
    },
    async remove(absPath, opts) {
      await fs.rm(absPath, { recursive: opts?.recursive ?? false, force: true });
    },
  };
}

function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx < 0 ? '.' : p.slice(0, idx);
}

// Kept if a future feature needs path joining here; currently unused but imported via 'node:path'.
void join;

function direntKind(e: Dirent): FileKind {
  if (e.isFile()) return 'file';
  if (e.isDirectory()) return 'directory';
  if (e.isSymbolicLink()) return 'symlink';
  return 'other';
}

function statKind(s: Stats): FileKind {
  if (s.isFile()) return 'file';
  if (s.isDirectory()) return 'directory';
  if (s.isSymbolicLink()) return 'symlink';
  return 'other';
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}
