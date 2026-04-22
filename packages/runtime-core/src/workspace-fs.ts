export type FileKind = 'file' | 'directory' | 'symlink' | 'other';

export interface DirEntry {
  name: string;
  kind: FileKind;
}

export interface WorkspaceFS {
  readFile(absPath: string): Promise<Uint8Array>;
  writeFile(absPath: string, bytes: Uint8Array): Promise<void>;
  readDirectory(absPath: string): Promise<DirEntry[]>;
  createDirectory(absPath: string): Promise<void>;
  stat(absPath: string): Promise<{ kind: FileKind; size: number; mtimeMs: number } | undefined>;
  exists(absPath: string): Promise<boolean>;
  remove(absPath: string, opts?: { recursive?: boolean }): Promise<void>;
}
